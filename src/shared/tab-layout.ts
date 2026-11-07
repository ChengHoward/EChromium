/** Desktop Chromium layout_constants.cc / TabStyle / Tab::Layout, in DIP.
 * The rounded-square 32 DIP add button follows the user's reference image.
 * Keep the existing compact pinned/active width policy for crowded tab strips.
 */
export const tabLayout = {
  stripHeight: 41,
  height: 35,
  topPadding: 6,
  contentBottomInset: 3,
  maxWidth: 232,
  pinnedWidth: 42,
  activeMinWidth: 112,
  faviconSize: 16,
  fontSize: 13,
  iconGap: 8,
  closeTarget: 26,
  closeIcon: 16,
  newButtonSize: 32,
  newButtonRadius: 8,
  newButtonBottom: 3,
  separatorWidth: 2,
  separatorHeight: 16,
  topRadius: 9,
  bottomRadius: 10,
} as const

export function tabLayoutStyle() {
  return Object.fromEntries(
    Object.entries(tabLayout).map(([key, value]) => [
      '--tab-' + key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
      `${value}px`,
    ]),
  )
}
