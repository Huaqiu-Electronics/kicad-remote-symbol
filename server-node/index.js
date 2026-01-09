const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ZstdCodec } = require('zstd-codec');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_DIR = path.resolve(__dirname, '../server/data');
const CONFIG_PATH = path.join(BASE_DIR, 'parts.json');

app.use(cors());
app.use(express.json());

// Global compressor instance
let zstdSimple = null;

// --- Constants & Helpers ---

const FIELD_PLAN = [
    { label: "Footprint", command: "DL_FOOTPRINT", mode: "SAVE", type: "footprint" },
    { label: "SPICE Model", command: "DL_SPICE", mode: "SAVE", type: null },
    { label: "3D Model", command: "DL_3DMODEL", mode: "SAVE", type: "3dmodel" },
    { label: "Symbol", command: "DL_SYMBOL", mode: "PLACE", type: "symbol" },
];

const GENERIC_IMAGE_DATA_URI = "data:image/svg+xml;base64," + Buffer.from(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='100' viewBox='0 0 160 100'>
  <defs>
    <linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>
      <stop offset='0%' stop-color='#e0e0e0'/>
      <stop offset='100%' stop-color='#bdbdbd'/>
    </linearGradient>
  </defs>
  <rect width='160' height='100' rx='12' fill='url(#g)'/>
  <path d='M25 75 L60 25 L100 25 L135 75 Z' fill='none' stroke='#616161' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>
  <circle cx='80' cy='50' r='10' fill='none' stroke='#757575' stroke-width='4'/>
  <text x='80' y='90' font-family='Arial, sans-serif' font-size='18' fill='#424242' text-anchor='middle'>No Image</text>
</svg>`
).toString('base64');

function getContentTypeForCommand(command) {
    const mapping = {
        "DL_SYMBOL": "KICAD_SYMBOL_V1",
        "DL_FOOTPRINT": "KICAD_FOOTPRINT_V1",
        "DL_SPICE": "KICAD_SPICE_MODEL_V1",
        "DL_3DMODEL": "KICAD_3D_MODEL_STEP",
    };
    return mapping[command] || "UNKNOWN";
}

function compressAndEncode(buffer) {
    if (!zstdSimple) {
        throw new Error("Zstd compressor not initialized yet");
    }
    const compressed = zstdSimple.compress(buffer);
    return Buffer.from(compressed).toString('base64');
}

function resolveAssetPath(relativePath) {
    const candidate = path.resolve(BASE_DIR, relativePath);
    const rel = path.relative(BASE_DIR, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Asset path '${relativePath}' must stay within ${BASE_DIR}`);
    }
    if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile()) {
        throw new Error(`Asset '${relativePath}' does not exist under ${BASE_DIR}`);
    }
    return candidate;
}

function getField(entry, key) {
    if (entry[key]) return String(entry[key]);

    const lowered = key.toLowerCase();
    const candidates = [
        lowered,
        key.replace(/ /g, ""),
        key.replace(/ /g, "_").toLowerCase()
    ];

    for (const k of Object.keys(entry)) {
        const kLow = k.toLowerCase();
        if (candidates.includes(kLow)) {
            return String(entry[k]);
        }
    }
    return null;
}

function encodeImage(relativePath) {
    if (!relativePath) return GENERIC_IMAGE_DATA_URI;
    try {
        const imagePath = resolveAssetPath(relativePath);
        const ext = path.extname(imagePath).toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === '.svg') mime = 'image/svg+xml';
        else if (ext === '.png') mime = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';

        const fileData = fs.readFileSync(imagePath);
        const encoded = fileData.toString('base64');
        return `data:${mime};base64,${encoded}`;
    } catch (err) {
        console.warn(`Failed to load image '${relativePath}':`, err.message);
        return GENERIC_IMAGE_DATA_URI;
    }
}

function extractAssetName(filePath, command) {
    const stem = path.basename(filePath, path.extname(filePath));
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const cmd = (command || "").toUpperCase();

        if (cmd === "DL_SYMBOL") {
            const m1 = content.match(/\(symbol\s+"([^"]+)"/);
            if (m1) return m1[1];
            const m2 = content.match(/^\s*DEF\s+(\S+)/m);
            if (m2) return m2[1];
        } else if (cmd === "DL_FOOTPRINT") {
            const m1 = content.match(/\(footprint\s+"([^"]+)"/);
            if (m1) return m1[1];
            const m2 = content.match(/^\s*module\s+([^\s(]+)/m);
            if (m2) return m2[1];
        }
    } catch (e) {
        // likely binary file or error reading
    }
    return stem;
}

function hashBytes(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// --- Main Builder Logic ---

function buildPart(entry, index) {
    const name = getField(entry, "Name");
    if (!name) throw new Error(`Part #${index} is missing 'Name'`);

    const symbolPath = getField(entry, "Symbol");
    if (!symbolPath) throw new Error(`Part '${name}' is missing 'Symbol'`);

    const assets = [];
    const componentEntries = [];
    const libraryName = path.basename(symbolPath, path.extname(symbolPath));

    for (const field of FIELD_PLAN) {
        const pathValue = getField(entry, field.label);
        if (!pathValue) continue;

        try {
            const filePath = resolveAssetPath(pathValue);
            const rawBuffer = fs.readFileSync(filePath);
            const encoded = compressAndEncode(rawBuffer);
            const extractedName = extractAssetName(filePath, field.command);
            const filename = path.basename(filePath);

            assets.push({
                command: field.command,
                label: field.label,
                filename: filename,
                data: encoded,
                parameters: {
                    mode: field.mode,
                    compression: "ZSTD",
                    content_type: getContentTypeForCommand(field.command),
                    library: libraryName,
                    name: extractedName
                },
                size_bytes: rawBuffer.length
            });

            if (field.type) {
                let componentName = (field.type === "3dmodel") ? filename : (extractedName || path.basename(filePath, path.extname(filePath)));

                componentEntries.push({
                    type: field.type,
                    name: componentName,
                    checksum: hashBytes(rawBuffer),
                    compression: "ZSTD",
                    content: encoded
                });
            }
        } catch (err) {
            console.warn(`Error processing asset '${field.label}' for part '${name}': ${err.message}`);
        }
    }

    if (assets.length === 0) {
        throw new Error(`Part '${name}' has no valid assets.`);
    }

    // Component Bundle Logic
    if (componentEntries.length > 0) {
        const componentJson = JSON.stringify(componentEntries);
        const componentBundle = compressAndEncode(Buffer.from(componentJson, 'utf-8'));

        assets.unshift({
            command: "DL_COMPONENT",
            label: "Component Bundle",
            filename: `${libraryName}_component_bundle.json`,
            data: componentBundle,
            parameters: {
                compression: "ZSTD",
                library: libraryName
            },
            size_bytes: Buffer.byteLength(componentJson)
        });
    }

    const imagePathValue = getField(entry, "Image");
    const imageData = encodeImage(imagePathValue);

    return {
        name: name,
        image: imageData,
        assets: assets
    };
}

// --- Routes ---

app.get('/api/parts', (req, res) => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            return res.status(500).json({ error: `Config file not found at ${CONFIG_PATH}` });
        }

        const rawData = fs.readFileSync(CONFIG_PATH, 'utf-8');
        let partsData;
        try {
            partsData = JSON.parse(rawData);
        } catch (e) {
            return res.status(500).json({ error: "Invalid JSON in parts.json" });
        }

        let partsList = [];
        if (Array.isArray(partsData)) {
            partsList = partsData;
        } else if (partsData.parts || partsData.Parts) {
            partsList = partsData.parts || partsData.Parts;
        } else {
            return res.status(500).json({ error: "Invalid parts structure" });
        }

        const result = [];
        let index = 1;
        for (const entry of partsList) {
            try {
                if (typeof entry !== 'object') throw new Error("Part entry is not an object");
                result.push(buildPart(entry, index));
            } catch (err) {
                console.warn(`Skipping invalid part #${index}:`, err.message);
            }
            index++;
        }

        console.log(`Loaded ${result.length} parts.`);
        res.json(result);
    } catch (err) {
        console.error("API Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.use(express.static(path.join(__dirname, '../client-vue/dist')));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }
    const indexHtml = path.join(__dirname, '../client-vue/dist/index.html');
    if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    } else {
        res.send('Vue app not built yet. Please run "npm run build" in client-vue and restart server.');
    }
});

// Initialization wrapper
ZstdCodec.run(zstd => {
    zstdSimple = new zstd.Simple();

    app.listen(PORT, () => {
        console.log(`Node.js KiCad Server running on http://localhost:${PORT}`);
        console.log(`Serving data from ${BASE_DIR}`);
    });
});
