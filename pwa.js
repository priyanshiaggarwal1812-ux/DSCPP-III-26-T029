if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .catch((error) => console.error('TradeX service worker registration failed:', error));
}
