import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Lock, User } from 'lucide-react';

export default function LoginDialog() {
  const { language } = useLanguage();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username.trim(), password);
      if (!success) {
        setError(
          language === 'zh'
            ? '用户名或密码错误'
            : 'Invalid username or password'
        );
        setPassword('');
      }
    } catch (error) {
      setError(
        language === 'zh'
          ? '登录失败，请稍后重试'
          : 'Login failed, please try again'
      );
      setPassword('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-2xl text-center">
            {language === 'zh' ? '登录' : 'Login'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {language === 'zh'
              ? '请输入您的账号和密码'
              : 'Please enter your username and password'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {language === 'zh' ? '用户名' : 'Username'}
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                placeholder={language === 'zh' ? '请输入用户名' : 'Enter username'}
                className="pl-10"
                autoFocus
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {language === 'zh' ? '密码' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder={language === 'zh' ? '请输入密码' : 'Enter password'}
                className="pl-10"
                required
              />
            </div>
          </div>
          {error && (
            <div className="text-sm text-red-600 text-center">{error}</div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading || !username.trim() || !password}
          >
            {isLoading
              ? language === 'zh'
                ? '登录中...'
                : 'Logging in...'
              : language === 'zh'
              ? '登录'
              : 'Login'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
