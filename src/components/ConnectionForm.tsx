import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, FileKeyIcon, FloppyDiskIcon, FolderOpenIcon, GitMergeIcon, Key01Icon, LockIcon, ServerStack01Icon, SlidersHorizontalIcon, Tick01Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { useMemo, useRef, useState } from 'react';
import type { ConnectionDraft, SSHConnection } from '../shared/types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useTranslation } from '../hooks/useTranslation';
import { cn } from '../lib/utils';

interface ConnectionFormProps {
    initialData?: Partial<SSHConnection>;
    draft?: ConnectionDraft | null;
    onSave: (data: SSHConnection) => void;
    onSaveDraft: (data: Partial<SSHConnection>, step: 1 | 2) => Promise<void>;
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
    passphrase: '',
    tags: [],
    jumpHost: '',
    jumpPort: 22,
    jumpUsername: '',
    jumpPassword: '',
    jumpPrivateKeyPath: '',
};

type WizardStep = 1 | 2;

export function ConnectionForm({
    initialData,
    draft,
    onSave,
    onSaveDraft,
    onClearDraft,
    onCancel,
}: ConnectionFormProps) {
    const { t, language } = useTranslation();
    const isEditing = Boolean(initialData?.id);
    const restoredDraft = !isEditing ? draft : null;
    const initialFormData = useMemo(
        () => ({ ...EMPTY_CONNECTION, ...(restoredDraft?.data ?? {}), ...initialData }),
        [initialData, restoredDraft],
    );

    const [step, setStep] = useState<WizardStep>(isEditing ? 2 : (restoredDraft?.step ?? 1));
    const [formData, setFormData] = useState<Partial<SSHConnection>>(initialFormData);
    const [showPassword, setShowPassword] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(Boolean(formData.tags?.length || formData.jumpHost));
    const [showJump, setShowJump] = useState(Boolean(formData.jumpHost));
    const [draftRecovered, setDraftRecovered] = useState(Boolean(restoredDraft));
    const [savingDraft, setSavingDraft] = useState(false);
    const [error, setError] = useState('');
    const nameInputRef = useRef<HTMLInputElement>(null);

    const copy = language === 'zh' ? {
        stepName: '连接名称',
        stepDetails: '连接信息',
        nameTitle: '先给这台服务器取个名字',
        nameDescription: '这个名称只用于在 Reflex 中识别服务器，之后可以随时修改。',
        next: '下一步',
        previous: '上一步',
        draft: '暂存',
        draftRecovered: '已恢复上次暂存的内容',
        clearDraft: '清除草稿',
        detailsTitle: '填写 SSH 连接信息',
        detailsDescription: '输入服务器地址，并选择密码或私钥认证。',
        advanced: '更多选项',
        advancedDescription: '标签与堡垒机',
        create: '创建并连接',
        saveChanges: '保存修改',
        nameRequired: '请输入连接名称',
        hostRequired: '请输入服务器 IP 或域名',
        portInvalid: '端口必须在 1–65535 之间',
        usernameRequired: '请输入用户名',
        passwordRequired: '请输入密码，或切换到私钥认证',
        keyRequired: '请选择或输入私钥文件路径',
        draftFailed: '暂存失败，请重试',
    } : {
        stepName: 'Connection name',
        stepDetails: 'Connection details',
        nameTitle: 'Name this server',
        nameDescription: 'This name is only used to identify the server in Reflex and can be changed later.',
        next: 'Next',
        previous: 'Back',
        draft: 'Save draft',
        draftRecovered: 'Your previous draft was restored',
        clearDraft: 'Clear draft',
        detailsTitle: 'Enter SSH connection details',
        detailsDescription: 'Add the server address and choose password or private-key authentication.',
        advanced: 'More options',
        advancedDescription: 'Tags and bastion host',
        create: 'Create and connect',
        saveChanges: 'Save changes',
        nameRequired: 'Enter a connection name',
        hostRequired: 'Enter a server IP address or domain',
        portInvalid: 'Port must be between 1 and 65535',
        usernameRequired: 'Enter a username',
        passwordRequired: 'Enter a password or switch to private-key authentication',
        keyRequired: 'Choose or enter a private-key file path',
        draftFailed: 'Could not save the draft. Try again.',
    };

    const set = (patch: Partial<SSHConnection>) => {
        setFormData((current) => ({ ...current, ...patch }));
        setError('');
    };

    const goToStep = (nextStep: WizardStep) => {
        if (nextStep === 2 && !formData.name?.trim()) {
            setError(copy.nameRequired);
            nameInputRef.current?.focus();
            return;
        }
        set({ name: formData.name?.trim() ?? '' });
        setStep(nextStep);
    };

    const validateDetails = () => {
        if (!formData.host?.trim()) return copy.hostRequired;
        const port = Number(formData.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return copy.portInvalid;
        if (!formData.username?.trim()) return copy.usernameRequired;
        if (formData.authType === 'password' && !formData.password) return copy.passwordRequired;
        if (formData.authType === 'privateKey' && !formData.privateKeyPath?.trim()) return copy.keyRequired;
        return '';
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (step === 1) {
            goToStep(2);
            return;
        }

        const validationError = validateDetails();
        if (validationError) {
            setError(validationError);
            return;
        }

        onSave({
            ...(formData as SSHConnection),
            id: formData.id || crypto.randomUUID(),
            name: formData.name!.trim(),
            host: formData.host!.trim(),
            username: formData.username!.trim(),
            privateKeyPath: formData.privateKeyPath?.trim(),
        });
    };

    const handleSaveDraft = async () => {
        if (!formData.name?.trim()) {
            setError(copy.nameRequired);
            nameInputRef.current?.focus();
            return;
        }
        setSavingDraft(true);
        try {
            await onSaveDraft({ ...formData, name: formData.name.trim() }, step);
        } catch {
            setError(copy.draftFailed);
            setSavingDraft(false);
        }
    };

    const handleClearDraft = async () => {
        await onClearDraft();
        setFormData({ ...EMPTY_CONNECTION });
        setStep(1);
        setDraftRecovered(false);
        setShowAdvanced(false);
        setShowJump(false);
        setError('');
        window.requestAnimationFrame(() => nameInputRef.current?.focus());
    };

    const pickFile = async (field: 'privateKeyPath' | 'jumpPrivateKeyPath') => {
        const path = await window.electron.openFileDialog({ title: t('connection.form.selectPrivateKey') });
        if (path) set({ [field]: path });
    };

    const labelClass = 'mb-1.5 block text-xs font-medium text-muted-foreground';
    const inputClass = 'h-11 rounded-xl bg-background/55 px-3.5';
    const compactInputClass = 'h-10 rounded-xl bg-background/55';

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-foreground/[0.035] p-1.5">
                {([
                    { id: 1 as const, label: copy.stepName },
                    { id: 2 as const, label: copy.stepDetails },
                ]).map((item) => {
                    const active = step === item.id;
                    const completed = step > item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => goToStep(item.id)}
                            disabled={item.id === 2 && !formData.name?.trim()}
                            className={cn(
                                'flex h-10 items-center gap-2 rounded-xl px-3 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                                active
                                    ? 'bg-foreground text-background shadow-sm'
                                    : 'text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground',
                            )}
                        >
                            <span className={cn(
                                'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                                active ? 'border-background/25 bg-background/10' : 'border-border/70',
                            )}>
                                {completed ? <HugeiconsIcon icon={Tick01Icon} className="h-3 w-3" /> : item.id}
                            </span>
                            <span className="font-medium">{item.label}</span>
                        </button>
                    );
                })}
            </div>

            {draftRecovered && !isEditing && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/[0.045] px-3 py-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                        <HugeiconsIcon icon={FloppyDiskIcon} className="h-3.5 w-3.5" />
                        {copy.draftRecovered}
                    </span>
                    <button type="button" onClick={() => void handleClearDraft()} className="rounded-lg px-2 py-1 text-[10px] hover:bg-foreground/[0.07] hover:text-foreground">
                        {copy.clearDraft}
                    </button>
                </div>
            )}

            {step === 1 ? (
                <section className="flex min-h-[280px] flex-col justify-center rounded-2xl border border-border/60 bg-card/25 px-6 py-8">
                    <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
                        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/[0.07]">
                            <HugeiconsIcon icon={ServerStack01Icon} className="h-5 w-5" />
                        </span>
                        <h3 className="text-lg font-semibold tracking-tight">{copy.nameTitle}</h3>
                        <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{copy.nameDescription}</p>
                        <div className="mt-6 w-full text-left">
                            <label className={labelClass}>{t('connection.form.name')}</label>
                            <Input
                                ref={nameInputRef}
                                autoFocus
                                value={formData.name ?? ''}
                                onChange={(event) => set({ name: event.target.value })}
                                placeholder={t('connection.form.nameDesc')}
                                className={cn(inputClass, 'text-base')}
                            />
                        </div>
                    </div>
                </section>
            ) : (
                <section className="space-y-4 rounded-2xl border border-border/60 bg-card/25 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold">{copy.detailsTitle}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">{copy.detailsDescription}</p>
                        </div>
                        <button type="button" onClick={() => setStep(1)} className="max-w-[180px] truncate rounded-lg bg-foreground/[0.055] px-2.5 py-1.5 text-[10px] font-medium hover:bg-foreground/[0.085]">
                            {formData.name}
                        </button>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                        <div>
                            <label className={labelClass}>{t('connection.form.hostIp')}</label>
                            <Input
                                autoFocus
                                value={formData.host ?? ''}
                                onChange={(event) => set({ host: event.target.value })}
                                placeholder="192.168.1.1"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelClass}>{t('connection.form.port')}</label>
                            <Input
                                type="number"
                                min={1}
                                max={65535}
                                value={formData.port ?? 22}
                                onChange={(event) => set({ port: Number(event.target.value) })}
                                className={inputClass}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={labelClass}>{t('connection.form.username')}</label>
                        <Input
                            value={formData.username ?? ''}
                            onChange={(event) => set({ username: event.target.value })}
                            placeholder="root"
                            className={inputClass}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>{t('connection.form.authMethod')}</label>
                        <div className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.04] p-1">
                            <button
                                type="button"
                                onClick={() => set({ authType: 'password' })}
                                className={cn(
                                    'flex h-9 items-center justify-center gap-2 rounded-lg text-xs transition-colors',
                                    formData.authType === 'password'
                                        ? 'bg-foreground text-background shadow-sm'
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
                                        ? 'bg-foreground text-background shadow-sm'
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
                            <label className={labelClass}>{t('connection.form.password')}</label>
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
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground"
                                    title={showPassword ? t('connection.form.hidePassword') : t('connection.form.showPassword')}
                                >
                                    {showPassword ? <HugeiconsIcon icon={ViewOffIcon} className="h-4 w-4" /> : <HugeiconsIcon icon={ViewIcon} className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                            <div>
                                <label className={labelClass}>{t('connection.form.privKeyFilePath')}</label>
                                <div className="flex gap-2">
                                    <Input
                                        value={formData.privateKeyPath ?? ''}
                                        onChange={(event) => set({ privateKeyPath: event.target.value })}
                                        placeholder="~/.ssh/id_ed25519"
                                        className={cn(inputClass, 'flex-1')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => void pickFile('privateKeyPath')}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground"
                                        title={t('connection.form.browse')}
                                    >
                                        <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className={labelClass}>{t('connection.form.passphrase')}</label>
                                <Input
                                    type="password"
                                    value={formData.passphrase ?? ''}
                                    onChange={(event) => set({ passphrase: event.target.value })}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                    )}

                    <div className="rounded-xl border border-border/55 bg-background/20">
                        <button
                            type="button"
                            onClick={() => setShowAdvanced((value) => !value)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-foreground/[0.035]"
                        >
                            <span className="flex items-center gap-2.5">
                                <HugeiconsIcon icon={SlidersHorizontalIcon} className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>
                                    <span className="block text-xs font-medium">{copy.advanced}</span>
                                    <span className="mt-0.5 block text-[10px] text-muted-foreground">{copy.advancedDescription}</span>
                                </span>
                            </span>
                            <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', showAdvanced && 'rotate-180')} />
                        </button>

                        {showAdvanced && (
                            <div className="space-y-3 px-3 pb-3">
                                <div>
                                    <label className={labelClass}>{t('connection.form.tags')}</label>
                                    <Input
                                        value={(formData.tags ?? []).join(', ')}
                                        onChange={(event) => set({ tags: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
                                        placeholder="Prod, CN-Hangzhou, Web"
                                        className={compactInputClass}
                                    />
                                </div>

                                <div className="overflow-hidden rounded-xl border border-border/55">
                                    <button
                                        type="button"
                                        onClick={() => setShowJump((value) => !value)}
                                        className="flex w-full items-center justify-between px-3 py-2.5 text-xs text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground"
                                    >
                                        <span className="flex items-center gap-2">
                                            <HugeiconsIcon icon={GitMergeIcon} className="h-3.5 w-3.5" />
                                            {t('connection.form.bastion')}
                                            {formData.jumpHost && <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] text-foreground">{t('connection.form.configured')}</span>}
                                        </span>
                                        <HugeiconsIcon icon={ArrowDown01Icon} className={cn('h-3.5 w-3.5 transition-transform', showJump && 'rotate-180')} />
                                    </button>

                                    {showJump && (
                                        <div className="grid gap-3 bg-foreground/[0.025] p-3 sm:grid-cols-2">
                                            <div>
                                                <label className={labelClass}>{t('connection.form.jumpIp')}</label>
                                                <Input value={formData.jumpHost ?? ''} onChange={(event) => set({ jumpHost: event.target.value })} className={compactInputClass} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('connection.form.port')}</label>
                                                <Input type="number" value={formData.jumpPort ?? 22} onChange={(event) => set({ jumpPort: Number(event.target.value) })} className={compactInputClass} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('connection.form.jumpUsername')}</label>
                                                <Input value={formData.jumpUsername ?? ''} onChange={(event) => set({ jumpUsername: event.target.value })} className={compactInputClass} />
                                            </div>
                                            <div>
                                                <label className={labelClass}>{t('connection.form.jumpPassword')}</label>
                                                <Input type="password" value={formData.jumpPassword ?? ''} onChange={(event) => set({ jumpPassword: event.target.value })} className={compactInputClass} />
                                            </div>
                                            <div className="sm:col-span-2">
                                                <label className={labelClass}>{t('connection.form.jumpPrivKeyPath')}</label>
                                                <div className="flex gap-2">
                                                    <Input value={formData.jumpPrivateKeyPath ?? ''} onChange={(event) => set({ jumpPrivateKeyPath: event.target.value })} className={cn(compactInputClass, 'flex-1')} />
                                                    <button type="button" onClick={() => void pickFile('jumpPrivateKeyPath')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground">
                                                        <HugeiconsIcon icon={FileKeyIcon} className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {error && (
                <div className="rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">{error}</div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
                <div>
                    {step === 2 ? (
                        <Button type="button" variant="ghost" onClick={() => setStep(1)} className="gap-2 rounded-xl">
                            <HugeiconsIcon icon={ArrowLeft01Icon} className="h-3.5 w-3.5" />
                            {copy.previous}
                        </Button>
                    ) : (
                        <Button type="button" variant="ghost" onClick={onCancel} className="rounded-xl">{t('connection.form.cancel')}</Button>
                    )}
                </div>

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
                            {copy.draft}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        variant="outline"
                        className="gap-2 rounded-xl border-0 bg-foreground px-4 text-background hover:bg-foreground/90 hover:text-background"
                    >
                        {step === 1 ? copy.next : (isEditing ? copy.saveChanges : copy.create)}
                        {step === 1 && <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>
        </form>
    );
}
