# Tool logos

Drop an SVG here named after the tool's key, then run `npm run site:logos`.

- The key is the tool's name on the board: a connector's name (`canva`, `slack`, `amplitude`),
  a chat app (`teams`, `email`), or a model service (`openai`, `groq`).
- A file here wins over Simple Icons, so it can also replace a logo.
- Square, no background, any colours. It is drawn as an image, never run.

Everything else comes from Simple Icons (CC0). Brands that asked Simple Icons to remove their
mark (Slack, Canva, OpenAI, Microsoft and others) are missing there: those show a lettered tile
until their SVG is added here.

## Where the files here come from

- `amplitude`, `aws-knowledge` (its dark letters made white, for McBot's dark tiles), `browser`
  (Playwright), `close`, `microsoft-learn`, `monday`, `slack`, `teams`, `twilio-docs`: Gil Barbara's
  [logos](https://github.com/gilbarbara/logos) (CC0 1.0).
- `comfy-cloud`, `exa`, `firecrawl`, `tavily`: [LobeHub icons](https://github.com/lobehub/lobe-icons)
  (MIT, © LobeHub), as the model marks are.
- `email`, `sms`, `irc`, `knowledge`, `thinking`: plain glyphs for things that have no brand, drawn
  with [Lucide](https://lucide.dev)'s paths (ISC).
- `canva`: [Devicon](https://github.com/devicons/devicon) (MIT, design/licences/devicon-LICENSE).
- `dingtalk`: [MingCute](https://github.com/Richard9394/MingCute) (Apache-2.0,
  design/licences/mingcute-LICENSE), drawn white for the dark tile.

Services Simple Icons has no mark for (OpenAI, xAI, Krea, Groq, fal, DeepInfra, Together) come from
LobeHub's icons in `scripts/tool-logos.ts` (`LOBE_TOOLS`, with each brand's tile colour), not from
files here.
