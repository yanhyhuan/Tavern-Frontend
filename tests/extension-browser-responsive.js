// Playwright CLI run-code entry. Start extension-browser-server.mjs first.
// Uses only synthetic tables and host APIs; this is not real-client acceptance.
async page => {
  const origin = new URL(page.url()).origin;
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const closeTour = async () => {
    const button = page.getByRole('button', { name: '关闭教程' });
    if (await button.isVisible().catch(() => false)) await button.click();
  };
  const inspect = async (name, width, height, positionMode = 'fixed') => {
    await page.goto(`${origin}/?mode=manual`, { waitUntil: 'networkidle' });
    await page.evaluate(mode => {
      localStorage.clear();
      localStorage.setItem('acu_ui_config_v19', JSON.stringify({ positionMode: mode, layout: 'horizontal' }));
    }, positionMode);
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/?fixture=default8`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window[Symbol.for('acu.dice.compat.extension')]?.status === 'running');
    await closeTour();
    await page.getByRole('button', { name: '打开重要角色表' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `.work/responsive/after-${name}.png`, fullPage: true });
    const metrics = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const content = document.querySelector('.acu-panel-content');
      const card = document.querySelector('.acu-data-card');
      const contentRect = content?.getBoundingClientRect();
      const cardRect = card?.getBoundingClientRect();
      const coarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
      const touchControls = [...document.querySelectorAll('.acu-nav-btn, .acu-action-btn')]
        .filter(element => element.getClientRects().length)
        .map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(), height: element.getBoundingClientRect().height }));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        root: rect('.acu-dice-ui-root'),
        panel: rect('.acu-data-display'),
        nav: rect('.acu-nav-container'),
        title: rect('.acu-panel-title'),
        content: rect('.acu-panel-content'),
        card: rect('.acu-data-card'),
        cardContained: !contentRect || !cardRect || cardRect.bottom <= contentRect.bottom + 1,
        coarse,
        touchControls,
      };
    });
    assert(metrics.documentWidth <= width + 1, `${name}: 页面横向溢出 ${metrics.documentWidth}/${width}`);
    assert(metrics.root && metrics.root.left >= -1 && metrics.root.right <= width + 1, `${name}: 根容器超出视口`);
    assert(metrics.panel && metrics.panel.left >= -1 && metrics.panel.right <= width + 1, `${name}: 数据面板超出视口`);
    assert(metrics.panel && metrics.panel.top >= -1 && metrics.panel.bottom <= height + 1, `${name}: 数据面板超出可视高度`);
    assert(metrics.cardContained, `${name}: 卡片仍被面板内容区裁切`);
    assert(metrics.title && metrics.title.width >= 48, `${name}: 面板标题被过度挤压`);
    if (metrics.coarse) {
      const tooSmall = metrics.touchControls.filter(control => control.height < 43.5);
      assert(tooSmall.length === 0, `${name}: 触控按钮不足 44px：${JSON.stringify(tooSmall)}`);
    }
    return metrics;
  };
  for (const [name, width, height, mode] of [
    ['desktop-1280', 1280, 900, 'fixed'],
    ['mobile-393', 393, 852, 'fixed'],
    ['narrow-320', 320, 700, 'fixed'],
    ['viewport-390', 390, 844, 'viewport'],
    ['embedded-393', 393, 852, 'embedded'],
  ]) {
    try {
      results.push({ name, ok: true, detail: await inspect(name, width, height, mode) });
    } catch (error) {
      results.push({ name, ok: false, error: String(error?.stack || error) });
    }
  }
  const summary = { total: results.length, failed: results.filter(result => !result.ok).length };
  const report = { summary, results: results.map(({ name, ok, error }) => ({ name, ok, error })) };
  console.log(JSON.stringify(report, null, 2));
  return report;
}
