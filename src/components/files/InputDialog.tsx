import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface Props {
    title: string;
    placeholder?: string;
    defaultValue?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export function InputDialog({ title, placeholder, defaultValue = '', onConfirm, onCancel }: Props) {
    const { t } = useTranslation();
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const submit = () => {
        const v = value.trim();
        if (v) { onConfirm(v); }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm animate-in fade-in">
            <div className="w-72 rounded-2xl border border-border/70 bg-card p-5 animate-in zoom-in-95">
                <h3 className="text-sm font-semibold mb-4">{title}</h3>
                <input
                    ref={inputRef}
                    className="mb-4 w-full rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm outline-none transition-colors focus:border-foreground/25 focus:ring-1 focus:ring-foreground/15"
                    placeholder={placeholder}
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') submit();
                        if (e.key === 'Escape') onCancel();
                    }}
                />
                <div className="flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        onClick={submit}
                        disabled={!value.trim()}
                        className="rounded-lg bg-foreground px-3 py-1.5 text-xs text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                        {t('common.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
