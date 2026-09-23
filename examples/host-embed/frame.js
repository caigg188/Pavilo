// 嵌进网页时逐字使用。每次 hello 都要换一张新凭证。不要在 identity-expired 时拆掉 iframe。
function attachPaviloFrame(iframe, paviloUrl, signIdentity) {
  const paviloOrigin = new URL(paviloUrl, window.location.href).origin;
  window.addEventListener('message', (event) => {
    if (!iframe || event.origin !== paviloOrigin || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.v !== 1 || data.source !== 'pavilo-embed' || data.type !== 'hello') return;
    Promise.resolve()
      .then(() => signIdentity())
      .then((session) => {
        if (!session || !session.identityToken || event.source !== iframe.contentWindow) return;
        iframe.contentWindow.postMessage({
          v: 1,
          source: 'pavilo-host',
          type: 'identity',
          instance: data.instance,
          channelId: session.channelId,
          username: session.username,
          identityToken: session.identityToken,
        }, paviloOrigin);
      })
      .catch(() => {});
  });
}
