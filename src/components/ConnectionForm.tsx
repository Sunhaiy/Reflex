import { useState } from 'react';
import { SSHConnection } from '../shared/types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Key, Lock, Server, GitMerge, ChevronDown, FolderOpen } from 'lucide-react';

interface ConnectionFormProps {
    initialData?: Partial<SSHConnection>;
    onSave: (data: SSHConnection) => void;
    onCancel: () => void;
}

export function ConnectionForm({ initialData, onSave, onCancel }: ConnectionFormProps) {
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
                <label className={labelCls}>连接名称</label>
                <Input
                    value={formData.name}
                    onChange={e => set({ name: e.target.value })}
                    placeholder={formData.host ? `${formData.username || 'root'}@${formData.host}` : '我的服务器'}
                />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className={`col-span-2 ${groupCls}`}>
                    <label className={labelCls}>主机 IP / 域名</label>
                    <Input
                        value={formData.host}
                        onChange={e => set({ host: e.target.value })}
                        placeholder="192.168.1.1"
                        required
                    />
                </div>
                <div className={groupCls}>
                    <label className={labelCls}>端口</label>
                    <Input
                        type="number"
                        value={formData.port}
                        onChange={e => set({ port: parseInt(e.target.value) || 22 })}
                    />
                </div>
            </div>

            <div className={groupCls}>
                <label className={labelCls}>用户名</label>
                <Input
                    value={formData.username}
                    onChange={e => set({ username: e.target.value })}
                    placeholder="root"
                />
            </div>

            {/* Auth Type Toggle */}
            <div>
                <label className={labelCls}>认证方式</label>
                <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 text-xs">
                    <button
                        type="button"
                        onClick={() => set({ authType: 'password' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${formData.authType === 'password'
                            ? 'bg-background shadow text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <Lock className="w-3 h-3" /> 密码
                    </button>
                    <button
                        type="button"
                        onClick={() => set({ authType: 'privateKey' })}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all ${formData.authType === 'privateKey'
                            ? 'bg-background shadow text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <Key className="w-3 h-3" /> 私钥
                    </button>
                </div>
            </div>

            {/* Auth Fields */}
            {formData.authType === 'password' ? (
                <div className={groupCls}>
                    <label className={labelCls}>密码</label>
                    <Input
                        type="password"
                        value={formData.password}
                        onChange={e => set({ password: e.target.value })}
                        placeholder="••••••••"
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    <div className={groupCls}>
                        <label className={labelCls}>私钥文件路径</label>
                        <div className="flex gap-1.5">
                            <Input
                                value={formData.privateKeyPath}
                                onChange={e => set({ privateKeyPath: e.target.value })}
                                placeholder="~/.ssh/id_rsa 或 /path/to/key.pem"
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
                        <label className={labelCls}>私钥密码短语（可选）</label>
                        <Input
                            type="password"
                            value={formData.passphrase}
                            onChange={e => set({ passphrase: e.target.value })}
                            placeholder="若密钥有密码则填写"
                        />
                    </div>
                </div>
            )}

            {/* Jump Host (collapsible) */}
            <div className="border border-border rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => setShowJump(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                    <div className="flex items-center gap-2">
                        <GitMerge className="w-3.5 h-3.5" />
                        跳板机 / Bastion Host
                        {formData.jumpHost && (
                            <span className="px-1.5 py-0 rounded-full bg-primary/15 text-primary text-[10px]">
                                已配置
                            </span>
                        )}
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showJump ? 'rotate-180' : ''}`} />
                </button>

                {showJump && (
                    <div className="p-3 bg-muted/20 space-y-3 border-t border-border">
                        <div className="grid grid-cols-3 gap-3">
                            <div className={`col-span-2 ${groupCls}`}>
                                <label className={labelCls}>跳板机 IP / 域名</label>
                                <Input
                                    value={formData.jumpHost}
                                    onChange={e => set({ jumpHost: e.target.value })}
                                    placeholder="bastion.example.com"
                                />
                            </div>
                            <div className={groupCls}>
                                <label className={labelCls}>端口</label>
                                <Input
                                    type="number"
                                    value={formData.jumpPort}
                                    onChange={e => set({ jumpPort: parseInt(e.target.value) || 22 })}
                                />
                            </div>
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>跳板机用户名</label>
                            <Input
                                value={formData.jumpUsername}
                                onChange={e => set({ jumpUsername: e.target.value })}
                                placeholder="ec2-user"
                            />
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>跳板机密码</label>
                            <Input
                                type="password"
                                value={formData.jumpPassword}
                                onChange={e => set({ jumpPassword: e.target.value })}
                                placeholder="或使用私钥路径"
                            />
                        </div>
                        <div className={groupCls}>
                            <label className={labelCls}>跳板机私钥路径（可选）</label>
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
                                    title="浏览文件"
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
                <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
                <Button type="submit">保存</Button>
            </div>
        </form>
    );
}
