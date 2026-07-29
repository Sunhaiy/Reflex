import { useState, useEffect, useRef } from 'react';

interface Props {
    currentPath: string;
    onNavigate: (path: string) => void;
}

export function FileBreadcrumb({ currentPath, onNavigate }: Props) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(currentPath);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setEditValue(currentPath);
        setIsEditing(false);
    }, [currentPath]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const commit = () => {
        onNavigate(editValue.trim() || '/');
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="flex h-7 flex-1 items-center rounded-lg bg-foreground/[0.045] px-2 ring-1 ring-foreground/15">
                <input
                    ref={inputRef}
                    className="flex-1 bg-transparent border-none outline-none text-xs font-mono"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') commit();
                        if (e.key === 'Escape') { setIsEditing(false); setEditValue(currentPath); }
                    }}
                    onBlur={() => { setIsEditing(false); setEditValue(currentPath); }}
                />
            </div>
        );
    }

    const segments = currentPath.split('/').filter(Boolean);
    const crumbs = [
        { name: '/', path: '/' },
        ...segments.map((seg, i) => ({ name: seg, path: '/' + segments.slice(0, i + 1).join('/') })),
    ];

    return (
        <div
            className="flex h-7 flex-1 cursor-text items-center overflow-hidden rounded-lg px-1 transition-colors hover:bg-foreground/[0.035]"
            onClick={() => setIsEditing(true)}
        >
            <div className="flex items-center text-xs text-muted-foreground whitespace-nowrap overflow-x-auto scrollbar-hide">
                {crumbs.map((c, i) => (
                    <div key={c.path} className="flex items-center">
                        {i > 0 && <span className="mx-0.5 opacity-40">/</span>}
                        <span
                            className="hover:text-foreground hover:bg-muted/60 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                            onClick={e => { e.stopPropagation(); onNavigate(c.path); }}
                        >
                            {c.name}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
