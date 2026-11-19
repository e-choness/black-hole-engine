import source from '../../../content/physics.md?raw';
import { renderNotes } from '../../lib/notes';

const notes = renderNotes(source, 'physics');

// Contents entries are buttons rather than fragment links: the view link owns the URL fragment.
function reveal(id: string): void {
    const heading = document.getElementById(id);
    if (!heading) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
}

export function PhysicsNotes() {
    return (
        <div className="physics-layout">
            <nav className="physics-toc" aria-label="Contents">
                <ol>
                    {notes.sections.map((section) => (
                        <li key={section.id}>
                            <button type="button" onClick={() => reveal(section.id)}>
                                {section.title}
                            </button>
                        </li>
                    ))}
                </ol>
            </nav>
            <article
                className="physics-doc"
                tabIndex={0}
                aria-label="Physics notes"
                dangerouslySetInnerHTML={{ __html: notes.html }}
            />
        </div>
    );
}
