import { useState } from 'react';
import { SSHConnection } from '../shared/types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Key, Lock, Server, GitMerge, ChevronDown, FolderOpen, Eye, EyeOff } from 'lucide-react';

interface ConnectionFormProps {
    initialData?: Partial<SSHConnection>;
    onSave: (data: SSHConnection) => void;
    onCancel: () => void;
}

export function ConnectionForm({ initialData, onSave, onCancel }: ConnectionFormProps) {
    const [showPassword, setShowPassword] = useState(false);
    const [formData, setFormData] = useState<Partial<SSHConnection>>({
        name: '',
        host: '',
        port: 22,
        username: 'root',
        password: '',
        authType: 'password',
        privateKeyPath: '',
        passphrase: '',
        jumpHost: '',
        jumpPort: 22,
        jumpUsername: '',
        jumpPassword: '',
        jumpPrivateKeyPath: '',
        ...initialData,
    });
    const [showJump, setShowJump] = useState(!!(initialData?.jumpHost));

    const set = (patch: Partial<SSHConnection>) => setFormData(prev => ({ ...prev, ...patch }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const id = formData.id || Date.now().toString();
        onSave({ ...(formData as SSHConnection), id });
    };

    const pickFile = async (field: 'privateKeyPath' | 'jumpPrivateKeyPath') => {
        const path = await (window as any).electron.openFileDialog({ title: '选择 SSH 私钥' });
        if (path) set({ [field]: path });
    };

    const labelCls = 'block text-xs font-medium text-muted-foreground mb-1';
    const groupCls = 'grid gap-1.5';

    return (
        <form onSubmit={handleSubmit} className="space-y-5">

            {/* Basic Info */}
            <div className={groupCls}>
                <label className={labelCls}>{t('connection.form.name')}</label>
                <Input
                    value={formData.name}
                    onChange={e => set({ name: e.target.value })}
                    placeholder={formData.host ? `${formData.username || 'root'}@${formData.host}` : { t('connection.form.nameDesc') }}
                />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className={`col-span-2 ${groupCls}`}>
                    <label className={labelCls}>{t('connection.form.hostIp')}</label>
                    <Input
                        value={formData.host}
                        onChange={e => set({ host: e.target.value })}
                        placeholder="192.168.1.1"
                        required
                    />
                </div>
                <div className={groupCls}>
                    <label className={labelCls}>{t('connection.form.port')}</label>
                    <Input
                        type="number"
                        value={formData.port}
                        onChange={e => set({ port: parseInt(e.target.value) || 22 })}
                    />
                </div>
            </div>

            <div className={groupCls}>
                <label className={labelCls}>{t('connection.form.username')}</label>
                <Input
                    value={formData.username}
                    onChange={e => set({ username: e.target.value })}
                    placeholder="root"
                />
            </div>

            {/* Auth Type Toggle */}
            <div>
                <label className={labelCls}>{t('connection.form.authMethod')}</label>
                <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 text-xs">
                    <button
                        type="button"
                        onClick={() => set({ authType: 'password' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${formData.authType === 'password'
                            ? 'bg-background shadow text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <Lock className="w-3 h-3" /> {t('connection.form.password')}
                    </button>
                    <button
                        type="button"
                        onClick={() => set({ authType: 'privateKey' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${formData.authType === 'privateKey'
                            ? 'bg-background shadow text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <Key className="w-3 h-3" /> {t('connection.form.privKey')}
                    </button>
                </div>
            </div>

            {/* Auth Fields */}
            {formData.authType === 'password' ? (
                <div className={groupCls}>
                    <label className={labelCls}>{t('connection.form.password')}</label>
                    <div className="flex gap-1.5">
                        <Input
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={e => set({ password: e.target.value })}
                            placeholder="••••••••"
                            className="flex-1"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(v => !v)}
                            className="px-2 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors border border-border"
                            title={showPassword ? '隐藏密码' : '显示密码'}
                        >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className={groupCls}>
                        <label className={labelCls}>{t('connection.form.privKeyFilePath')}</label>
                        <div className="flex gap-1.5">
                            <Input
                                value={formData.privateKeyPath}
                                onChange={e => set({ privateKeyPath: e.target.value })}
                                placeholder="~/.ssh/id_rsa {t('connection.form.or')} /path/to/key.pem"
                                className="flex-1"
                            />
                            <button
                                type="button"
                                onClick={() => pickFile('privateKeyPath')}
                                className="px-2 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors border border-border"
                                title="浏览文件"
                            >
                                <FolderOpen className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className={groupCls}>
                        <label className={labelCls}>{t('connection.form.passphrase')}</label>
                        <Input
                            type="password"
                            value={formData.passphrase}
                            onChange={e => set({ passphrase: e.target.value })}
                            placeholder="{t('connection.form.passphraseDesc')}"
                        />
                    </div>
                </div>
            )}

            {/* Tags */}
            <div className={groupCls}>
                <label className={labelCls}>{t('connection.form.tags')}</label>
                <Input
                    value={(formData.tags || []).join(', ')}
                    onChange={e => set({ tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                    placeholder="Prod, CN-Hangzhou, Web"
                />
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">{t('connection.form.tagsDesc')}</p>
            </div>

            {/* Jump Host (collapsible) */}
            <div className="border border-border rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => setShowJump(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <GitMerge className="w-3.5 h-3.5" />
                        {t('connection.form.bastion')}
                        {formData.jumpHost && (
                            <span className="px-1.5 py-0 rounded-full bg-primary/15 text-primary text-[10px]">
                                {t('connection.form.configured')}
                            </span>
                        )}
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showJump ? 'rotate-180' : ''}`} />
                </button>

                {showJump && (
                    <div className="p-3 bg-muted/20 space-y-3 border-t border-border">
                        <div className="grid grid-cols-3 gap-3">
                            <div className={`col-span-2 ${groupCls}`}>
                                <label className={labelCls}>{t('connection.form.jumpIp')}</label>
                                <Input
                                    value={formData.jumpHost}
                                    onChange={e => set({ jumpHost: e.target.value })}
                                    placeholder="bastion.example.com"
                                />
                            </div>
                            <div className={groupCls}>
                                <label className={labelCls}>{t('connection.form.port')}</label>
                                <Input
                                    type="number"
                                    value={formData.jumpPort}
                                    onChange={e => set({ jumpPort: parseInt(e.target.value) || 22 })}
                                />
                            </div>
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>{t('connection.form.jumpUsername')}</label>
                            <Input
                                value={formData.jumpUsername}
                                onChange={e => set({ jumpUsername: e.target.value })}
                                placeholder="ec2-user"
                            />
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>{t('connection.form.jumpPassword')}</label>
                            <Input
                                type="password"
                                value={formData.jumpPassword}
                                onChange={e => set({ jumpPassword: e.target.value })}
                                placeholder="{t('connection.form.JumpPrivKeyDesc')}"
                            />
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>{t('connection.form.jumpPrivKeyPaht')}</label>
                            <div className="flex gap-1.5">
                                <Input
                                    value={formData.jumpPrivateKeyPath}
                                    onChange={e => set({ jumpPrivateKeyPath: e.target.value })}
                                    placeholder="~/.ssh/jump_key"
                                    className="flex-1"
                                />
                                <button
                                    type="button"
                                    onClick={() => pickFile('jumpPrivateKeyPath')}
                                    className="px-2 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors border border-border"
                                    title="{t('connection.form.browse')}"
                                >
                                    <FolderOpen className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onCancel}>{t('connection.form.cancel')}</Button>
                <Button type="submit">{t('connection.form.confirm')}</Button>
            </div>
        </form>
    );
}
