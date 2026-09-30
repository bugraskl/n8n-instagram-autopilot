# Create human-approved Instagram posts with Gemini and Telegram

## Template description

This workflow helps small businesses, agencies, and social media teams create Instagram posts with AI while keeping a human in control of every publication. A teammate submits a public HTTPS image URL, a product or service name, verified facts, and an optional call to action through a Basic Auth-protected n8n form. Gemini analyzes the real image and returns a structured caption, five hashtags, a confidence score, and any risks it detects.

Before anyone can approve the draft, deterministic checks reject malformed or low-confidence output, invented-risk reports, banned marketing claims, missing product names, invalid caption lengths, and incomplete hashtag sets. Passing drafts are sent to Telegram with a unique n8n approval form. The workflow pauses until a reviewer explicitly approves or rejects the post. Only an approval creates and publishes an Instagram media container; rejections, quality failures, and Meta processing delays never publish content and are reported in Telegram.

To set it up, connect Basic Auth, Google Gemini(PaLM), Telegram, and Facebook Graph API credentials, then update the brand, channel, and Instagram account values in the configuration node. The Instagram account must be a professional account linked to a Facebook Page. Source images must use a public HTTPS JPG, PNG, or WebP URL and remain reachable while Meta processes the post.

## Submission metadata

- **Category:** Marketing
- **Primary integration:** Instagram / Facebook Graph API
- **Other integrations:** Google Gemini, Telegram, n8n Form
- **Audience:** small businesses, agencies, and social media teams
- **Workflow file:** `workflows/human-approved-instagram-post.json`

## Reviewer highlights

- Human approval is mandatory; there is no autonomous publishing path.
- The model may only use facts supplied by the submitter.
- Deterministic safety checks run independently of the model.
- Meta container processing is checked twice before publishing.
- The workflow is a single importable JSON file with no external scripts, filesystem mounts, or community nodes.
