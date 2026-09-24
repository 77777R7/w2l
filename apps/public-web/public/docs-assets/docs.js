document.addEventListener('click', async event => {
  const button = event.target.closest('.copy-code')
  if (!button) return
  const code = button.closest('.doc-code')?.querySelector('code')?.textContent
  if (!code) return
  const original = button.textContent
  const announcement = document.querySelector('#copy-announcement')
  try {
    await navigator.clipboard.writeText(code)
    button.textContent = 'Copied'
    if (announcement) announcement.textContent = 'Code copied to clipboard.'
  } catch {
    button.textContent = 'Copy failed'
    if (announcement) announcement.textContent = 'Clipboard access is unavailable. Select the code to copy it.'
  }
  window.setTimeout(() => { button.textContent = original }, 2200)
})

function selectMcpTab(tab, focus = false) {
  const picker = tab.closest('.mcp-picker')
  if (!picker) return
  for (const candidate of picker.querySelectorAll('[role="tab"]')) {
    const selected = candidate === tab
    candidate.setAttribute('aria-selected', String(selected))
    candidate.tabIndex = selected ? 0 : -1
    const panel = picker.querySelector(`#${candidate.getAttribute('aria-controls')}`)
    if (panel) panel.hidden = !selected
  }
  if (focus) tab.focus()
}

document.addEventListener('click', event => {
  const tab = event.target.closest('.mcp-client-tab')
  if (tab) selectMcpTab(tab)
})

document.addEventListener('keydown', event => {
  const tab = event.target.closest('.mcp-client-tab')
  if (!tab) return
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(tab)
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  selectMcpTab(tabs[next], true)
})
