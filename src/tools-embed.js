(() => {
  'use strict';
  const frame = document.getElementById('shipping-frame');
  const status = document.getElementById('shipping-loading');
  let selected, loading = false, ready = false;

  frame.addEventListener('load', () => {
    const workspace = frame.contentWindow.ShippingWorkspace;
    if (!loading || !frame.hasAttribute('srcdoc')) return;
    loading = false;
    if (!workspace) {
      status.textContent = '工作台加载失败，请重新选择工具。';
      return;
    }
    workspace.show(selected);
    ready = true;
    frame.hidden = false;
    status.hidden = true;
  });

  window.ShippingEmbed = {
    async show(view) {
      selected = view;
      if (ready) { frame.contentWindow.ShippingWorkspace.show(view); return; }
      if (loading) return;
      loading = true;
      status.textContent = '正在加载工作台';
      status.hidden = false;
      try {
        const bundle = document.getElementById('shipping-bundle');
        if (!bundle) throw new Error('未构建工具箱，请打开离线版。');
        const bytes = Uint8Array.from(atob(bundle.textContent.trim()), char => char.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        frame.srcdoc = await new Response(stream).text();
      } catch (error) {
        loading = false;
        status.textContent = '工作台加载失败：' + error.message;
      }
    }
  };
})();
