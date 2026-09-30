import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const id = (suffix) => `57f4d89a-18d6-4eb1-9f20-${suffix}`;

const workflow = {
  name: 'Create human-approved Instagram posts with Gemini and Telegram',
  nodes: [
    {
      parameters: {
        authentication: 'basicAuth',
        formTitle: 'Create an Instagram post',
        formDescription: 'Submit a public HTTPS image URL and a few verified facts. Gemini drafts the post, but nothing is published until a human approves it.',
        formFields: {
          values: [
            { fieldLabel: 'Public image URL', fieldName: 'image_url', fieldType: 'text', placeholder: 'https://cdn.example.com/product.jpg', requiredField: true },
            { fieldLabel: 'Product or service name', fieldName: 'product_name', fieldType: 'text', placeholder: 'Lemon Tart', requiredField: true },
            { fieldLabel: 'Verified facts', fieldName: 'verified_facts', fieldType: 'textarea', placeholder: 'Only include facts you are comfortable publishing, such as ingredients, material, size, or availability.', requiredField: true },
            { fieldLabel: 'Call to action', fieldName: 'call_to_action', fieldType: 'text', placeholder: 'Visit our profile to learn more', requiredField: false },
          ],
        },
        options: {
          appendAttribution: false,
          respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Your draft is being prepared. You will receive a Telegram approval link shortly.' } },
        },
      },
      id: id('000000000001'),
      name: 'Submit Post Request',
      type: 'n8n-nodes-base.formTrigger',
      typeVersion: 2.4,
      position: [-1220, 180],
      webhookId: id('100000000001'),
    },
    {
      parameters: {
        mode: 'raw',
        jsonOutput: `{
  "brand_name": "Your Brand",
  "brand_voice": "clear, warm, specific, and never exaggerated",
  "audience": "people interested in our products and services",
  "language": "English",
  "instagram_user_id": "YOUR_INSTAGRAM_USER_ID",
  "graph_api_version": "v23.0",
  "telegram_chat_id": "YOUR_TELEGRAM_CHAT_ID",
  "gemini_model": "gemini-2.5-flash",
  "minimum_confidence": 0.75,
  "required_hashtags": ["YourBrand", "YourCity"],
  "fallback_hashtags": ["smallbusiness", "localbusiness", "discovermore"],
  "banned_phrases": ["guaranteed", "best ever", "miracle", "risk-free", "limited time"]
}`,
        options: {},
      },
      id: id('000000000002'),
      name: 'Configure Brand and Channels',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-1000, 180],
    },
    {
      parameters: {
        jsCode: `const request = $('Submit Post Request').first().json;
const cfg = $('Configure Brand and Channels').first().json;
const imageUrl = String(request.image_url || '').trim();
const productName = String(request.product_name || '').trim();
const facts = String(request.verified_facts || '').trim();

if (!/^https:\\/\\//i.test(imageUrl)) throw new Error('Public image URL must start with https://');
if (!/\\.(?:jpe?g|png|webp)(?:\\?.*)?$/i.test(imageUrl)) throw new Error('Image URL must point to a JPG, PNG, or WebP file.');
if (productName.length < 2 || productName.length > 100) throw new Error('Product name must be between 2 and 100 characters.');
if (facts.length < 10 || facts.length > 1200) throw new Error('Verified facts must be between 10 and 1200 characters.');

return [{ json: {
  image_url: imageUrl,
  product_name: productName,
  verified_facts: facts,
  call_to_action: String(request.call_to_action || '').trim(),
  requested_at: new Date().toISOString(),
  brand_name: cfg.brand_name,
} }];`,
      },
      id: id('000000000003'),
      name: 'Validate Submission',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-780, 180],
    },
    {
      parameters: {
        url: '={{ $json.image_url }}',
        options: {
          timeout: 30000,
          response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
        },
      },
      id: id('000000000004'),
      name: 'Download Submitted Image',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.3,
      position: [-560, 180],
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1500,
    },
    {
      parameters: {
        jsCode: `const cfg = $('Configure Brand and Channels').first().json;
const req = $('Validate Submission').first().json;
const prompt = [
  'You are a careful social media editor for ' + cfg.brand_name + '.',
  'Analyze the attached image and write one Instagram caption in ' + cfg.language + '.',
  'Brand voice: ' + cfg.brand_voice + '.',
  'Audience: ' + cfg.audience + '.',
  'Product or service name: ' + req.product_name + '.',
  'These are the only verified facts you may state: ' + req.verified_facts,
  req.call_to_action ? 'Requested call to action: ' + req.call_to_action : 'Use a gentle, non-salesy call to action.',
  'Never invent ingredients, prices, discounts, awards, availability, health claims, or visual details.',
  'Return valid JSON only with this shape:',
  '{"caption":"80-700 characters, no hashtags","hashtags":["five","relevant","tags"],"confidence":0.0,"risks":[]}',
  'Set confidence below 0.75 or list a risk whenever the image conflicts with the verified facts or is unclear.',
].join('\\n');

return [{ json: { ...req, analysis_prompt: prompt }, binary: $binary }];`,
      },
      id: id('000000000005'),
      name: 'Prepare Guarded AI Prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-340, 180],
    },
    {
      parameters: {
        resource: 'image',
        operation: 'analyze',
        modelId: { __rl: true, value: "={{ 'models/' + $('Configure Brand and Channels').first().json.gemini_model }}", mode: 'id' },
        text: '={{ $json.analysis_prompt }}',
        inputType: 'binary',
        options: {},
      },
      id: id('000000000006'),
      name: 'Draft Caption with Gemini',
      type: '@n8n/n8n-nodes-langchain.googleGemini',
      typeVersion: 1.1,
      position: [-120, 180],
    },
    {
      parameters: {
        jsCode: `const cfg = $('Configure Brand and Channels').first().json;
const req = $('Validate Submission').first().json;
const clean = (value) => String(value || '').replace(/[\\r\\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const tag = (value) => clean(value).replace(/^#+/, '').replace(/[^\\p{L}\\p{N}_]/gu, '');
let raw = '';
try { raw = $json.content.parts[0].text || ''; } catch (e) {}
if (!raw && $json.text) raw = $json.text;
raw = String(raw).replace(/\`\`\`(?:json)?/gi, '').trim();

let draft;
try { draft = JSON.parse(raw); } catch (e) {
  return [{ json: { passed: false, reason: 'Gemini did not return valid JSON.', raw_reply: raw.slice(0, 1000) } }];
}

const caption = clean(draft.caption);
const confidence = Number(draft.confidence);
const risks = Array.isArray(draft.risks) ? draft.risks.map(clean).filter(Boolean) : [];
const banned = (cfg.banned_phrases || []).filter((p) => caption.toLocaleLowerCase().includes(String(p).toLocaleLowerCase()));
const tags = [];
for (const candidate of [...(cfg.required_hashtags || []), ...(draft.hashtags || []), ...(cfg.fallback_hashtags || [])]) {
  const value = tag(candidate);
  if (value && !tags.some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase())) tags.push(value);
  if (tags.length === 5) break;
}
const failures = [];
if (caption.length < 80 || caption.length > 700) failures.push('caption length is outside 80-700 characters');
if (!caption.toLocaleLowerCase().includes(req.product_name.toLocaleLowerCase())) failures.push('product name is missing');
if (!Number.isFinite(confidence) || confidence < Number(cfg.minimum_confidence || 0.75)) failures.push('model confidence is too low');
if (risks.length) failures.push('model reported: ' + risks.join('; '));
if (banned.length) failures.push('banned phrase found: ' + banned.join(', '));
if (tags.length !== 5) failures.push('could not build exactly five unique hashtags');

const captionFull = caption + '\\n\\n' + tags.map((value) => '#' + value).join(' ');
const esc = (value) => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const approvalHtml = '<img src="' + esc(req.image_url) + '" alt="Draft image" style="max-width:100%;border-radius:12px">' +
  '<h3>' + esc(req.product_name) + '</h3><p style="white-space:pre-wrap">' + esc(captionFull) + '</p>' +
  '<p><strong>AI confidence:</strong> ' + Math.round((Number.isFinite(confidence) ? confidence : 0) * 100) + '%</p>';

return [{ json: {
  passed: failures.length === 0,
  reason: failures.join('; '),
  image_url: req.image_url,
  product_name: req.product_name,
  caption: captionFull,
  confidence,
  approval_html: approvalHtml,
} }];`,
      },
      id: id('000000000007'),
      name: 'Apply Deterministic Quality Gates',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [100, 180],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          combinator: 'and',
          conditions: [{ id: id('200000000001'), leftValue: '={{ $json.passed }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
        },
        options: {},
      },
      id: id('000000000008'),
      name: 'Draft Passed Safety Checks?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [320, 180],
    },
    {
      parameters: {
        chatId: "={{ $('Configure Brand and Channels').first().json.telegram_chat_id }}",
        text: `={{ 'Instagram draft ready for review\\n\\n' + $('Apply Deterministic Quality Gates').first().json.caption + '\\n\\nImage: ' + $('Apply Deterministic Quality Gates').first().json.image_url + '\\n\\nApprove or reject: ' + $execution.resumeFormUrl }}`,
        additionalFields: {},
      },
      id: id('000000000009'),
      name: 'Send Draft and Approval Link',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [560, 60],
      webhookId: id('100000000009'),
    },
    {
      parameters: {
        resume: 'form',
        formTitle: 'Review Instagram draft',
        formDescription: "={{ $('Apply Deterministic Quality Gates').first().json.approval_html }}",
        formFields: {
          values: [
            { fieldLabel: 'Decision', fieldType: 'radio', fieldOptions: { values: [{ option: 'Approve and publish' }, { option: 'Reject' }] }, requiredField: true },
            { fieldLabel: 'Reviewer note', fieldType: 'textarea', placeholder: 'Optional reason or edit request', requiredField: false },
          ],
        },
        options: {
          appendAttribution: false,
          respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Decision received. You can close this page.' } },
        },
      },
      id: id('000000000010'),
      name: 'Wait for Human Approval',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [780, 60],
      webhookId: id('100000000010'),
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          combinator: 'and',
          conditions: [{ id: id('200000000002'), leftValue: '={{ $json.Decision }}', rightValue: 'Approve and publish', operator: { type: 'string', operation: 'equals' } }],
        },
        options: {},
      },
      id: id('000000000011'),
      name: 'Approved for Publishing?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1000, 60],
    },
    {
      parameters: {
        httpRequestMethod: 'POST',
        graphApiVersion: "={{ $('Configure Brand and Channels').first().json.graph_api_version }}",
        node: "={{ $('Configure Brand and Channels').first().json.instagram_user_id }}",
        edge: 'media',
        options: { queryParameters: { parameter: [
          { name: 'image_url', value: "={{ $('Apply Deterministic Quality Gates').first().json.image_url }}" },
          { name: 'caption', value: "={{ $('Apply Deterministic Quality Gates').first().json.caption }}" },
        ] } },
      },
      id: id('000000000012'),
      name: 'Create Instagram Media Container',
      type: 'n8n-nodes-base.facebookGraphApi',
      typeVersion: 1,
      position: [1240, -40],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
    },
    {
      parameters: { amount: 15, unit: 'seconds' },
      id: id('000000000013'),
      name: 'Wait for Instagram Processing',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [1460, -40],
      webhookId: id('100000000013'),
    },
    {
      parameters: {
        graphApiVersion: "={{ $('Configure Brand and Channels').first().json.graph_api_version }}",
        node: '={{ $json.id }}',
        options: { queryParameters: { parameter: [{ name: 'fields', value: 'status_code' }] } },
      },
      id: id('000000000014'),
      name: 'Check Container Status',
      type: 'n8n-nodes-base.facebookGraphApi',
      typeVersion: 1,
      position: [1680, -40],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          combinator: 'and',
          conditions: [{ id: id('200000000003'), leftValue: '={{ $json.status_code }}', rightValue: 'FINISHED', operator: { type: 'string', operation: 'equals' } }],
        },
        options: {},
      },
      id: id('000000000015'),
      name: 'Container Ready?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1900, -40],
    },
    {
      parameters: { amount: 20, unit: 'seconds' },
      id: id('000000000016'),
      name: 'Wait Once More',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [2120, 100],
      webhookId: id('100000000016'),
    },
    {
      parameters: {
        graphApiVersion: "={{ $('Configure Brand and Channels').first().json.graph_api_version }}",
        node: '={{ $json.id }}',
        options: { queryParameters: { parameter: [{ name: 'fields', value: 'status_code' }] } },
      },
      id: id('000000000017'),
      name: 'Recheck Container Status',
      type: 'n8n-nodes-base.facebookGraphApi',
      typeVersion: 1,
      position: [2340, 100],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          combinator: 'and',
          conditions: [{ id: id('200000000004'), leftValue: '={{ $json.status_code }}', rightValue: 'FINISHED', operator: { type: 'string', operation: 'equals' } }],
        },
        options: {},
      },
      id: id('000000000018'),
      name: 'Container Ready After Retry?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2560, 100],
    },
    {
      parameters: {
        httpRequestMethod: 'POST',
        graphApiVersion: "={{ $('Configure Brand and Channels').first().json.graph_api_version }}",
        node: "={{ $('Configure Brand and Channels').first().json.instagram_user_id }}",
        edge: 'media_publish',
        options: { queryParameters: { parameter: [{ name: 'creation_id', value: '={{ $json.id }}' }] } },
      },
      id: id('000000000019'),
      name: 'Publish Approved Post',
      type: 'n8n-nodes-base.facebookGraphApi',
      typeVersion: 1,
      position: [2780, -40],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
    },
    {
      parameters: {
        graphApiVersion: "={{ $('Configure Brand and Channels').first().json.graph_api_version }}",
        node: '={{ $json.id }}',
        options: { queryParameters: { parameter: [{ name: 'fields', value: 'permalink,timestamp' }] } },
      },
      id: id('000000000020'),
      name: 'Get Published Post Link',
      type: 'n8n-nodes-base.facebookGraphApi',
      typeVersion: 1,
      position: [3000, -40],
      retryOnFail: true,
      onError: 'continueRegularOutput',
    },
    {
      parameters: {
        chatId: "={{ $('Configure Brand and Channels').first().json.telegram_chat_id }}",
        text: `={{ '✅ Instagram post published for ' + $('Apply Deterministic Quality Gates').first().json.product_name + ($json.permalink ? '\\n' + $json.permalink : '') }}`,
        additionalFields: {},
      },
      id: id('000000000021'),
      name: 'Confirm Publication in Telegram',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [3220, -40],
      webhookId: id('100000000021'),
    },
    {
      parameters: {
        chatId: "={{ $('Configure Brand and Channels').first().json.telegram_chat_id }}",
        text: `={{ '🛑 Instagram draft rejected. Nothing was published.' + ($json['Reviewer note'] ? '\\nReviewer note: ' + $json['Reviewer note'] : '') }}`,
        additionalFields: {},
      },
      id: id('000000000022'),
      name: 'Confirm Rejection in Telegram',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [1240, 180],
      webhookId: id('100000000022'),
    },
    {
      parameters: {
        chatId: "={{ $('Configure Brand and Channels').first().json.telegram_chat_id }}",
        text: `={{ '⚠️ Instagram draft stopped before review. Nothing was published.\\nReason: ' + $json.reason }}`,
        additionalFields: {},
      },
      id: id('000000000023'),
      name: 'Report Quality Gate Failure',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [560, 300],
      webhookId: id('100000000023'),
    },
    {
      parameters: {
        chatId: "={{ $('Configure Brand and Channels').first().json.telegram_chat_id }}",
        text: `={{ '⚠️ Instagram accepted the media container but it was not ready after two checks. Nothing was published. Status: ' + ($json.status_code || 'unknown') }}`,
        additionalFields: {},
      },
      id: id('000000000024'),
      name: 'Report Instagram Processing Delay',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [2780, 180],
      webhookId: id('100000000024'),
    },
    {
      parameters: {
        content: `## Create human-approved Instagram posts with Gemini and Telegram

This workflow is for small businesses, agencies, and social teams that want AI-assisted Instagram publishing without giving an AI permission to post unchecked content. A user submits a public HTTPS product image, the product name, verified facts, and an optional call to action through an authenticated n8n form. Gemini analyzes the actual image and returns a structured caption, five hashtags, a confidence score, and any risks it noticed.

Deterministic gates then reject low-confidence drafts, invented-risk reports, banned claims, missing product names, invalid caption lengths, or malformed hashtag sets. Passing drafts are sent to Telegram with a private n8n approval form. The Instagram Graph API is called only after a reviewer explicitly selects **Approve and publish**. Rejections and processing failures never publish anything and are reported back to Telegram.

### Setup
1. Add Basic Auth, Google Gemini(PaLM), Telegram, and Facebook Graph API credentials to the matching nodes.
2. Fill in **Configure Brand and Channels**.
3. Use an Instagram professional account linked to a Facebook Page.
4. Test with a public JPG, PNG, or WebP URL.
5. Publish the workflow and bookmark the production form URL.

The source image must remain publicly reachable while Meta creates the media container.`,
        height: 820,
        width: 520,
        color: 4,
      },
      id: id('000000000025'),
      name: 'Note: Overview and Setup',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-1280, -760],
    },
    {
      parameters: { content: '### 1. Collect verified input\nThe form deliberately asks for verified facts instead of letting the model invent product details. The validator accepts only public HTTPS image URLs and common web image formats.', height: 180, width: 860 },
      id: id('000000000026'),
      name: 'Note: Verified Input',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-1240, -80],
    },
    {
      parameters: { content: '### 2. Draft and guard\nGemini sees the submitted image and may use only the supplied facts. Code then enforces confidence, risk, length, product-name, banned-phrase, and exactly-five-hashtag rules before a human ever sees the draft.', height: 200, width: 900 },
      id: id('000000000027'),
      name: 'Note: AI and Safety Gates',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-300, -100],
    },
    {
      parameters: { content: '### 3. Human approval\nTelegram carries the draft and a unique resume-form URL. The execution pauses here. Rejecting the draft ends safely; only an explicit approval reaches Meta.', height: 180, width: 680 },
      id: id('000000000028'),
      name: 'Note: Human Approval',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [520, -240],
    },
    {
      parameters: { content: '### 4. Publish safely\nThe workflow creates an Instagram media container, polls twice for processing, publishes only when Meta reports `FINISHED`, fetches the permalink, and confirms the result in Telegram.', height: 180, width: 1320 },
      id: id('000000000029'),
      name: 'Note: Publish and Confirm',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [1220, -300],
    },
  ],
  connections: {
    'Submit Post Request': { main: [[{ node: 'Configure Brand and Channels', type: 'main', index: 0 }]] },
    'Configure Brand and Channels': { main: [[{ node: 'Validate Submission', type: 'main', index: 0 }]] },
    'Validate Submission': { main: [[{ node: 'Download Submitted Image', type: 'main', index: 0 }]] },
    'Download Submitted Image': { main: [[{ node: 'Prepare Guarded AI Prompt', type: 'main', index: 0 }]] },
    'Prepare Guarded AI Prompt': { main: [[{ node: 'Draft Caption with Gemini', type: 'main', index: 0 }]] },
    'Draft Caption with Gemini': { main: [[{ node: 'Apply Deterministic Quality Gates', type: 'main', index: 0 }]] },
    'Apply Deterministic Quality Gates': { main: [[{ node: 'Draft Passed Safety Checks?', type: 'main', index: 0 }]] },
    'Draft Passed Safety Checks?': { main: [
      [{ node: 'Send Draft and Approval Link', type: 'main', index: 0 }],
      [{ node: 'Report Quality Gate Failure', type: 'main', index: 0 }],
    ] },
    'Send Draft and Approval Link': { main: [[{ node: 'Wait for Human Approval', type: 'main', index: 0 }]] },
    'Wait for Human Approval': { main: [[{ node: 'Approved for Publishing?', type: 'main', index: 0 }]] },
    'Approved for Publishing?': { main: [
      [{ node: 'Create Instagram Media Container', type: 'main', index: 0 }],
      [{ node: 'Confirm Rejection in Telegram', type: 'main', index: 0 }],
    ] },
    'Create Instagram Media Container': { main: [[{ node: 'Wait for Instagram Processing', type: 'main', index: 0 }]] },
    'Wait for Instagram Processing': { main: [[{ node: 'Check Container Status', type: 'main', index: 0 }]] },
    'Check Container Status': { main: [[{ node: 'Container Ready?', type: 'main', index: 0 }]] },
    'Container Ready?': { main: [
      [{ node: 'Publish Approved Post', type: 'main', index: 0 }],
      [{ node: 'Wait Once More', type: 'main', index: 0 }],
    ] },
    'Wait Once More': { main: [[{ node: 'Recheck Container Status', type: 'main', index: 0 }]] },
    'Recheck Container Status': { main: [[{ node: 'Container Ready After Retry?', type: 'main', index: 0 }]] },
    'Container Ready After Retry?': { main: [
      [{ node: 'Publish Approved Post', type: 'main', index: 0 }],
      [{ node: 'Report Instagram Processing Delay', type: 'main', index: 0 }],
    ] },
    'Publish Approved Post': { main: [[{ node: 'Get Published Post Link', type: 'main', index: 0 }]] },
    'Get Published Post Link': { main: [[{ node: 'Confirm Publication in Telegram', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: 'v1' },
};

const output = resolve('workflows/human-approved-instagram-post.json');
writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(output);
