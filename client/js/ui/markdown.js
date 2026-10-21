// Markdown for assistant messages. Transcripts are local but may contain raw HTML: escape it, and only allow http(s) links.
import { marked } from 'marked';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ENTITIES[c]);

marked.use({
  renderer: {
    html: html => escapeHtml(html),
    link: (href, title, text) => /^https?:/i.test(href || '') ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>` : text,
    image: (href, title, text) => escapeHtml(text || ''),
  },
});

export const renderMarkdown = text => marked.parse(text);
