const { ZstdCodec } = require('zstd-codec');

ZstdCodec.run(zstd => {
    try {
        const simple = new zstd.Simple();
        const data = Buffer.from('hello world');
        const compressed = simple.compress(data);
        console.log('Compressed size:', compressed.length);
        console.log('Success');
    } catch (e) {
        console.error('Failed:', e);
    }
});
