/** First hosted slice loads only reviewed HTTPS hosts and does not fetch
 * image/font/media bodies. Their DOM URLs remain available for extraction. */
export function hostedBrowserRequestAllowed(url: string, resourceType: string, hosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && hosts.has(parsed.hostname) && !parsed.username && !parsed.password
      && !['image','font','media'].includes(resourceType)
  } catch { return false }
}
