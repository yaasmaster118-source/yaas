(() => {
  const modes = ['mobile', 'desktop'];
  const originals = new Map();
  let mode;
  function apply(next) {
    if (!modes.includes(next)) return;
    mode = next;
    document.documentElement.dataset.layout = mode;
    const width = mode === 'mobile' ? 390 : 1440;
    function visit(rules) {
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE) {
          if (!originals.has(rule)) originals.set(rule, rule.media.mediaText);
          const original = originals.get(rule);
          rule.media.mediaText = original.replace(/\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/gi, (_, bound, value) => {
            const matches = bound.toLowerCase() === 'min' ? width >= Number(value) : width <= Number(value);
            return matches ? '(min-width: 0px)' : '(max-width: 0px)';
          });
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    }
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
    document.querySelector('#layout-dialog').close();
  }
  function init() {
    document.querySelectorAll('[data-layout-choice]').forEach(button => button.addEventListener('click', () => apply(button.dataset.layoutChoice)));
    const dialog = document.querySelector('#layout-dialog');
    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.showModal();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
