import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon, FloppyDiskIcon, FolderOpenIcon, Key01Icon, LockIcon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from 'react';
import type { ConnectionDraft, SSHConnection } from '../shared/types';
import { normalizeProviderUrl } from '../shared/providerUrl';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

interface ConnectionFormProps {
    initialData?: Partial<SSHConnection>;
    draft?: ConnectionDraft | null;
    onSave: (data: SSHConnection) => void;
    onSaveDraft: (data: Partial<SSHConnection>) => Promise<void>;
    onClearDraft: () => Promise<void>;
    onCancel: () => void;
}

const EMPTY_CONNECTION: Partial<SSHConnection> = {
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
    authType: 'password',
    privateKeyPath: '',
    privateKey: '',
    passphrase: '',
    providerUrl: '',
};

// Kept compact on purpose: with the recovered-draft banner on top, the taller rhythm
// pushed the form past the modal's max height and put a scrollbar on every field.
const inputClass = 'h-10 rounded-xl bg-background/55 px-3.5';
const sideButtonClass = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/[0.055] hover:text-foreground';

/**
 * Required and optional are separated by contrast rather than colour: a required label
 * sits at full foreground with a small accent asterisk, an optional one is muted with a
 * quiet badge. Tinting the borders too made the whole form read as a warning.
 */
function FieldLabel({ text, required, optionalText }: { text: string; required?: boolean; optionalText: string }) {
    return (
        <span className="mb-1 flex items-center gap-1.5">
            <span className={cn('text-xs font-medium', required ? 'text-foreground' : 'text-muted-foreground')}>{text}</span>
            {required
                ? <span className="text-xs leading-none text-primary" aria-hidden="true">*</span>
                : (
                    <span className="rounded px-1 py-px text-[10px] font-normal leading-4 text-muted-foreground/60 ring-1 ring-inset ring-border/60">
                        {optionalText}
                    </span>
                )}
        </span>
    );
}

/** Mirrors the fallback in App.normalizeConnection so the placeholder matches what gets saved. */
function autoName(data: Partial<SSHConnection>) {
    const host = data.host?.trim();
    if (!host) return '';
    return `${data.username?.trim() || 'root'}@${host}`;
}

export function ConnectionForm({
    initialData,
    draft,
    onSave,
    onSaveDraft,
    onClearDraft,
    onCancel,
}: ConnectionFormProps) {
    const { t } = useTranslation();
    const isEditing = Boolean(initialData?.id);
    const restoredDraft = !isEditing ? draft : null;
    const initialFormData = useMemo(
        () => ({ ...EMPTY_CONNECTION, ...(restoredDraft?.data ?? {}), ...initialData }),
        [initialData, restoredDraft],
    );

    const [formData, setFormData] = useState<Partial<SSHConnection>>(initialFormData);
    const [showPassword, setShowPassword] = useState(false);
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [keySource, setKeySource] = useState<'file' | 'paste'>(
        initialFormData.privateKey?.trim() ? 'paste' : 'file',
    );
    const [draftRecovered, setDraftRecovered] = useState(Boolean(restoredDraft));
    const [savingDraft, setSavingDraft] = useState(false);
    const [error, setError] = useState('');

    const set = (patch: Partial<SSHConnection>) => {
        setFormData((current) => ({ ...current, ...patch }));
        setError('');
    };

    const providerLink = normalizeProviderUrl(formData.providerUrl);

    const validate = () => {
        if (!formData.host?.trim()) return t('form.hostRequired');
        const port = Number(formData.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return t('form.portInvalid');
        if (!formData.username?.trim()) return t('form.usernameRequired');
        if (formData.authType === 'password' && !formData.password) return t('form.passwordRequired');
        if (formData.authType === 'privateKey'
            && !formData.privateKeyPath?.trim()
            && !formData.privateKey?.trim()) return t('form.keyRequired');
        if (formData.providerUrl?.trim() && !providerLink) return t('form.providerInvalid');
        return '';
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        const trimmedName = formData.name?.trim();
        onSave({
            ...(formData as SSHConnection),
            id: formData.id || crypto.randomUUID(),
            name: trimmedName || autoName(formData),
            host: formData.host!.trim(),
            username: formData.username!.trim(),
            privateKeyPath: formData.privateKeyPath?.trim(),
            privateKey: formData.privateKey?.trim() || undefined,
            providerUrl: formData.providerUrl?.trim() || undefined,
        });
    };

    const handleSaveDraft = async () => {
        setSavingDraft(true);
        try {
            await onSaveDraft({ ...formData, name: formData.name?.trim() ?? '' });
        } catch {
            setError(t('form.draftFailed'));
            setSavingDraft(false);
        }
    };

    const handleClearDraft = async () => {
        await onClearDraft();
        setFormData({ ...EMPTY_CONNECTION });
        setKeySource('file');
        setShowPassphrase(false);
        setDraftRecovered(false);
        setError('');
    };

    const pickFile = async () => {
        const path = await window.electron.openFileDialog({ title: t('connection.form.selectPrivateKey') });
        if (path) set({ privateKeyPath: path, privateKey: '' });
    };

    const optionalText = t('common.optional');
    const Label = (props: { text: string; required?: boolean }) => (
        <FieldLabel {...props} optionalText={optionalText} />
    );

    return (
        <form onSubmit={handleSubmit} className="space-y-3.5">
            {draftRecovered && !isEditing && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.045] px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                        <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
                        {t('form.draftRecovered')}
                    </span>
                    <button type="button" onClick={() => void handleClearDraft()} className="rounded-lg px-2 py-1 text-[10px] hover:bg-foreground/[0.07] hover:text-foreground">
                        {t('form.clearDraft')}
                    </button>
                </div>
            )}

            <section className="space-y-3.5 rounded-2xl border border-border/60 bg-card/25 p-4">
                <div>
                    <h3 className="text-sm font-semibold">{t('form.detailsTitle')}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('form.detailsDescription')}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                        <Label text={t('connection.form.name')} />
                        <Input
                            value={formData.name ?? ''}
                            onChange={(event) => set({ name: event.target.value })}
                            placeholder={autoName(formData) || t('connection.form.nameDesc')}
                            className={inputClass}
                        />
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{t('connection.form.nameAutoDesc')}</p>
                    </label>
                    <div className="block">
                        <Label text={t('connection.form.providerUrl')} />
                        <div className="flex gap-2">
                            <Input
                                value={formData.providerUrl ?? ''}
                                onChange={(event) => set({ providerUrl: event.target.value })}
                                placeholder="aliyun.com"
                                className={cn(inputClass, 'min-w-0 flex-1')}
                            />
                            <button
                                type="button"
                                onClick={() => providerLink && void window.electron.openExternal(providerLink)}
                                disabled={!providerLink}
                                className={cn(sideButtonClass, 'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent')}
                                title={t('form.openProvider')}
                            >
                                <HugeiconsIcon icon={ArrowUpRight01Icon} className="h-4 w-4" />
                            </button>
                        </div>
                        <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{t('connection.form.providerUrlDesc')}</p>
                    </div>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3 border-t border-border/45 pt-3.5">
                    <label className="block">
                        <Label text={t('connection.form.hostIp')} required />
                        <Input
                            autoFocus
                            value={formData.host ?? ''}
                            onChange={(event) => set({ host: event.target.value })}
                            placeholder="192.168.1.1"
                            className={inputClass}
                        />
                    </label>
                    <label className="block">
                        <Label text={t('connection.form.port')} required />
                        <Input
                            type="number"
                            min={1}
                            max={65535}
                            value={formData.port ?? 22}
                            onChange={(event) => set({ port: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </label>
                </div>

                <label className="block">
                    <Label text={t('connection.form.username')} required />
                    <Input
                        value={formData.username ?? ''}
                        onChange={(event) => set({ username: event.target.value })}
                        placeholder="root"
                        className={inputClass}
                    />
                </label>

                <div>
                    <Label text={t('connection.form.authMethod')} required />
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1">
                        <button
                            type="button"
                            onClick={() => set({ authType: 'password' })}
                            className={cn(
                                'flex h-9 items-center justify-center gap-2 rounded-lg text-xs transition-colors',
                                formData.authType === 'password'
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                            )}
                        >
                            <HugeiconsIcon icon={LockIcon} className="h-3.5 w-3.5" />
                            {t('connection.form.password')}
                        </button>
                        <button
                            type="button"
                            onClick={() => set({ authType: 'privateKey' })}
                            className={cn(
                                'flex h-9 items-center justify-center gap-2 rounded-lg text-xs transition-colors',
                                formData.authType === 'privateKey'
                                    ? 'bg-foreground text-background'
                                    : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
                            )}
                        >
                            <HugeiconsIcon icon={Key01Icon} className="h-3.5 w-3.5" />
                            {t('connection.form.privKey')}
                        </button>
                    </div>
                </div>

                {formData.authType === 'password' ? (
                    <div>
                        <Label text={t('connection.form.password')} required />
                        <div className="flex gap-2">
                            <Input
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password ?? ''}
                                onChange={(event) => set({ password: event.target.value })}
                                placeholder="••••••••"
                                className={cn(inputClass, 'flex-1')}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((value) => !value)}
                                className={sideButtonClass}
                                title={showPassword ? t('connection.form.hidePassword') : t('connection.form.showPassword')}
                            >
                                {showPassword ? <HugeiconsIcon icon={ViewOffIcon} className="h-4 w-4" /> : <HugeiconsIcon icon={ViewIcon} className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div>
                            <Label text={t('connection.form.privKeySource')} required />
                            <div className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setKeySource('file');
                                        set({ privateKey: '' });
                                    }}
                                    className={cn(
                                        'h-8 rounded-lg text-xs transition-colors',
                                        keySource === 'file'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {t('connection.form.privKeyFile')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setKeySource('paste');
                                        set({ privateKeyPath: '' });
                                    }}
                                    className={cn(
                                        'h-8 rounded-lg text-xs transition-colors',
                                        keySource === 'paste'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {t('connection.form.privKeyPaste')}
                                </button>
                            </div>
                        </div>

                        {keySource === 'file' ? (
                            <div>
                                <Label text={t('connection.form.privKeyFilePath')} required />
                                <div className="flex gap-2">
                                    <Input
                                        value={formData.privateKeyPath ?? ''}
                                        onChange={(event) => set({ privateKeyPath: event.target.value, privateKey: '' })}
                                        placeholder="~/.ssh/id_ed25519"
                                        className={cn(inputClass, 'flex-1')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void pickFile()}
                                        className={sideButtonClass}
                                        title={t('connection.form.browse')}
                                    >
                                        <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <Label text={t('connection.form.privKeyContent')} required />
                                <textarea
                                    value={formData.privateKey ?? ''}
                                    onChange={(event) => set({ privateKey: event.target.value, privateKeyPath: '' })}
                                    placeholder={t('connection.form.privKeyPlaceholder')}
                                    rows={5}
                                    spellCheck={false}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    className="min-h-[112px] w-full resize-y rounded-xl border border-input bg-background/55 px-3.5 py-2.5 font-mono text-[11px] leading-5 outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-primary"
                                />
                            </div>
                        )}

                        <div>
                            <Label text={t('connection.form.passphrase')} />
                            <div className="flex gap-2">
                                <Input
                                    type={showPassphrase ? 'text' : 'password'}
                                    value={formData.passphrase ?? ''}
                                    onChange={(event) => set({ passphrase: event.target.value })}
                                    placeholder={t('connection.form.passphraseDesc')}
                                    autoComplete="off"
                                    className={cn(inputClass, 'flex-1')}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassphrase((value) => !value)}
                                    className={sideButtonClass}
                                    title={showPassphrase ? t('connection.form.hidePassword') : t('connection.form.showPassword')}
                                >
                                    {showPassphrase
                                        ? <HugeiconsIcon icon={ViewOffIcon} className="h-4 w-4" />
                                        : <HugeiconsIcon icon={ViewIcon} className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {error && (
                <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
            )}

            <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={onCancel} className="rounded-xl">{t('connection.form.cancel')}</Button>

                <div className="flex items-center gap-2">
                    {!isEditing && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleSaveDraft()}
                            disabled={savingDraft}
                            className="gap-2 rounded-xl"
                        >
                            <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
                            {t('form.draft')}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        variant="outline"
                        className="gap-2 rounded-xl border-0 bg-foreground px-4 text-background hover:bg-foreground/90 hover:text-background"
                    >
                        {isEditing ? t('form.saveChanges') : t('form.create')}
                    </Button>
                </div>
            </div>
        </form>
    );
}
