# Third party notices

## Navora

The EChromium prototype adapts palette values and the adjacent-tab selection
rule from Navora, and draws on its BrowserPage / BrowserHostManager,
BrowserTabsService, native window chrome, Acrylic material, native address
suggestion panels, persistent window-find panels and layout designs. Find input
refreshes follow Navora's rule of omitting values during result/theme/geometry
updates. The fixture-only native pointer and Unicode keyboard helpers
follow Navora's pattern of validating an owned test window before posting messages.
The implementation removes chat and Agent ownership and uses an independent
browser profile model. Source reference: `D:/electron/navora-harness/navora-desktop`.

Navora license:

MIT License

Copyright (c) Navora

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Runtime and dependencies

Electron and Chromium contain their own licenses and third party notices in
the selected runtime distribution. Retain those files when redistributing it.
Vue, Vite, esbuild, TypeScript and other npm dependencies retain their package
licenses; exact resolved dependencies are recorded in package-lock.json.

The old app/ tree contains historical bundled fonts and extensions. They are
not copied into the new renderer build; check their individual distribution
rights before packaging them with a release.
