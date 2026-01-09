/// <reference types="vite/client" />

interface Window {
  chrome?: {
    webview?: {
      postMessage: (message: any) => void;
    };
  };
  webkit?: {
    messageHandlers?: {
      kicad?: {
        postMessage: (message: any) => void;
      };
    };
  };
  external?: {
    invoke: (message: any) => void;
  };
  kiclient?: {
    postMessage: (message: any) => void;
  };
}
