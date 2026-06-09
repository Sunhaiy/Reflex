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
            <div className="bg-card border border-border rounded-xl shadow-2xl w-72 p-5 animate-in zoom-in-95">
                <h3 className="text-sm font-semibold mb-4">{title}</h3>
                <input
                    ref={inputRef}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted/30 outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-colors mb-4"
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
                        className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                    >
                        {t('common.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
