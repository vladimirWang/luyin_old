# Design QA

- Source visual truth: user-provided “图一” reference image in the current conversation.
- Implementation target: `/login` and protected not-found route in the local Vite app.
- Intended viewport: 390 × 844, mobile portrait.
- State: login default/loading state and authenticated unknown-route 404 state.
- Implementation screenshot: unavailable because the in-app browser runtime reported `Browser is not available: iab`.
- Full-view comparison evidence: unavailable; a browser-rendered implementation capture could not be produced.
- Focused region comparison evidence: unavailable for the same reason. The intended focused regions are the login title/header, QR card, 404 title block, and bottom action buttons.

## Findings

- [P1] Rendered visual fidelity cannot be verified.
  - Location: login and 404 screens.
  - Evidence: the source reference is available, but there is no browser-rendered implementation screenshot to place beside it.
  - Impact: typography wrapping, QR iframe sizing, mobile vertical fit, shadows, and visual density cannot be judged reliably from code alone.
  - Fix: capture both routes at 390 × 844 in the in-app browser, compare against the supplied reference, and correct any visible P1/P2 drift.

## Required fidelity surfaces

- Fonts and typography: implemented with the existing system font stack and heavier display weights; rendered weight and wrapping remain unverified.
- Spacing and layout rhythm: mobile-specific spacing, large radii, and full-height behavior are implemented; rendered fit remains unverified.
- Colors and visual tokens: cool gray-blue background, near-black primary actions, coral accents, translucent white cards, and low-contrast shadows are implemented; visual sampling remains unverified.
- Image quality and asset fidelity: the reference contains no required photographic or branded raster assets for these two screens. Interface icons use the project’s installed icon library. The enterprise login QR remains supplied by the official WeCom iframe.
- Copy and content: login and not-found copy remain task-appropriate and unchanged except for the new visual eyebrow labels.

## Comparison history

- Initial implementation completed from the supplied reference.
- No visual comparison iteration was possible because no in-app browser instance was available.

## Implementation checklist

- Capture `/login` at 390 × 844.
- Capture authenticated unknown route at 390 × 844.
- Compare source and implementation in one visual input.
- Fix visible typography, spacing, overflow, color, or elevation differences.
- Repeat until no P0/P1/P2 issues remain.

final result: blocked
