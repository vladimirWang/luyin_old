# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Authentication decisions: Enterprise WeChat is the only supported login method. Every client route except `/login`, including the 404 route, must require a persisted Enterprise WeChat user identity. Keep the detailed Enterprise WeChat user in the Zustand auth store and initiate OAuth automatically when the app is opened inside Enterprise WeChat.

Navigation decisions: the protected workbench uses `/recorder`, `/records`, and `/detail` for the recorder, recording list, and recording detail views. Preserve the selected recording in the detail route query string. The records header exposes the current Enterprise WeChat user through a compact avatar menu with logout.

Visual direction: login and not-found screens follow the recording-list reference style—cool gray-blue atmospheric background, oversized heavy black display type, translucent white cards with generous radii, near-black primary actions, coral secondary accents, circular outline-icon controls, and soft low-contrast shadows.
