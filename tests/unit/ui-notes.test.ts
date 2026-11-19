import { describe, expect, test } from 'vitest';
import physicsSource from '../../src/content/physics.md?raw';
import { renderNotes } from '../../src/ui/lib/notes';

describe('notes rendering', () => {
    test('drops the title and moves the other headings one level down', () => {
        const { html, sections } = renderNotes(
            '# Title\n\nIntro.\n\n## First part\n\nText.\n\n### A detail\n\n## Second `code` & more\n',
            'doc',
        );
        expect(html).not.toContain('Title');
        expect(html).toContain('<h3 id="doc-first-part" tabindex="-1">First part</h3>');
        expect(html).toContain('<h4 id="doc-a-detail" tabindex="-1">A detail</h4>');
        expect(sections).toEqual([
            { id: 'doc-first-part', title: 'First part' },
            { id: 'doc-second-code-more', title: 'Second code & more' },
        ]);
    });

    test('gives repeated headings distinct ids', () => {
        const { html } = renderNotes('## Notes\n\n### Notes\n\n## Notes\n', 'doc');
        expect(html.match(/id="[^"]+"/g)).toEqual([
            'id="doc-notes"',
            'id="doc-notes-2"',
            'id="doc-notes-3"',
        ]);
    });

    test('keeps equations preformatted and tables with their header', () => {
        const { html } = renderNotes(
            '    a^2 + b^2 = c^2\n\n| x | y |\n| - | - |\n| 1 | 2 |\n',
            'doc',
        );
        expect(html).toContain('<pre><code>a^2 + b^2 = c^2\n</code></pre>');
        expect(html).toContain('<th>x</th>');
        expect(html).toContain('<td>2</td>');
    });

    test('lists every section of the physics notes under its own id', () => {
        const { html, sections } = renderNotes(physicsSource, 'physics');
        expect(sections.map((section) => section.title)).toContain('Solvers');
        expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
        expect(html).not.toContain('<h1');
    });
});
