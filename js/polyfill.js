if (!(window.HTMLDialogElement && HTMLDialogElement.prototype.showModal)) {
  for (const d of document.querySelectorAll('dialog')) {
    d.showModal = function showModal() {
      this.setAttribute('open', '');
      this.classList.add('polyfill');
    };
    d.close = function close() {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.classList.remove('polyfill');
      this.dispatchEvent(new Event('close'));
    };
    Object.defineProperty(d, 'open', { get() { return this.hasAttribute('open'); } });
  }
}
