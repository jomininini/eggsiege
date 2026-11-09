export function bootErrorMessage(error: unknown, english: boolean): { title: string; hint: string; detail: string; reload: string } {
  const detail = error instanceof Error ? error.message : String(error)
  const webgl = /webgl|graphics context|gpu/i.test(detail)
  return {
    title: english ? 'The game could not start' : '游戏暂时无法启动',
    hint: webgl
      ? (english ? 'WebGL 2 could not initialize. Enable hardware acceleration in your browser, update your graphics driver, and reload.' : '无法初始化 WebGL 2。请开启浏览器硬件加速、更新显卡驱动，然后重新加载。')
      : (english ? 'Reload the game. If this continues, check your connection and share the error below.' : '请重新加载游戏。如果问题持续，请检查网络连接，并提供以下错误信息。'),
    detail,
    reload: english ? 'Reload game' : '重新加载游戏',
  }
}

export function showBootError(error: unknown, english: boolean): void {
  console.error('[game] Startup failed:', error)
  const message = bootErrorMessage(error, english)
  const root = document.getElementById('ui')
  if (!root) return
  const screen = document.createElement('section')
  screen.className = 'screen boot on boot-error'
  screen.setAttribute('role', 'alert')
  const card = document.createElement('div')
  card.className = 'boot-card'
  const title = document.createElement('h1')
  title.textContent = message.title
  const hint = document.createElement('p')
  hint.textContent = message.hint
  const detail = document.createElement('pre')
  detail.textContent = message.detail
  const button = document.createElement('button')
  button.className = 'btn gold'
  button.textContent = message.reload
  button.onclick = () => location.reload()
  card.append(title, hint, detail, button)
  screen.append(card)
  root.replaceChildren(screen)
}
