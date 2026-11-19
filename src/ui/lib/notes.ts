import { Marked } from 'marked';

export interface NotesSection {
    id: string;
    title: string;
}

export interface Notes {
    sections: NotesSection[];
    html: string;
}

function slug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// Renders a Markdown document bundled with the app, so trusted, to HTML for the dialog that shows
// it. The dialog's title stands in for the document's own title, so that heading is dropped and
// the others move one level down below the dialog's; the second-level headings are the sections
// of the contents list. Ids start with idPrefix so that they cannot clash with the interface's.
export function renderNotes(source: string, idPrefix: string): Notes {
    const sections: NotesSection[] = [];
    const ids = new Set<string>();
    const marked = new Marked({
        gfm: true,
        renderer: {
            heading({ tokens, depth }) {
                if (depth === 1) return '';
                const title = this.parser.parseInline(tokens, this.parser.textRenderer);
                const base = `${idPrefix}-${slug(title)}`;
                let id = base;
                for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`;
                ids.add(id);
                if (depth === 2) sections.push({ id, title });
                const level = Math.min(depth + 1, 6);
                const content = this.parser.parseInline(tokens);
                return `<h${level} id="${id}" tabindex="-1">${content}</h${level}>\n`;
            },
        },
    });
    return { sections, html: marked.parse(source, { async: false }) };
}
