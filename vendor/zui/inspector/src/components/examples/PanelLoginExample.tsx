import { useState } from 'react';
import { PanelLogin, Heading } from '@cypher-asi/zui';
import type { LoginProvider } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function panelloginExample() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (email: string, password: string) => {
    console.log('Login submitted:', { email, password });
    
    // Simulate a login request
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      alert(`Login attempted with:\nEmail: ${email}\nPassword: ${password}`);
    }, 1500);
  };

  const loginProviders: LoginProvider[] = [
    {
      id: 'google',
      icon: <span>G</span>,
      label: 'Continue with Google',
      onClick: () => console.log('Google login clicked'),
    },
    {
      id: 'x',
      icon: <span>X</span>,
      label: 'Continue with X',
      onClick: () => console.log('X login clicked'),
    },
    {
      id: 'github',
      icon: <span>GH</span>,
      label: 'Continue with GitHub',
      onClick: () => console.log('GitHub login clicked'),
    },
  ];

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          PanelLogin with Image
        </Heading>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            borderRadius: '12px',
            minHeight: '650px',
          }}
        >
          <PanelLogin
            appName="Liquid Glass"
            description="Welcome back. Please log in to your account"
            emailValue={email}
            onEmailChange={setEmail}
            passwordValue={password}
            onPasswordChange={setPassword}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            image="https://i.pinimg.com/736x/7d/a9/93/7da993ea181a49912defefcc4c41c33a.jpg"
            imageHeight="200px"
            loginProviders={loginProviders}
            onRegisterClick={() => console.log('Register clicked')}
            onForgotPasswordClick={() => console.log('Forgot password clicked')}
          />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Without Image
        </Heading>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            background: 'linear-gradient(135deg, #2c3e50 0%, #34495e 100%)',
            borderRadius: '12px',
            minHeight: '650px',
          }}
        >
          <PanelLogin
            appName="ZUI Dashboard"
            description="Enter your credentials to continue"
            emailValue=""
            onEmailChange={(val) => console.log('Email:', val)}
            passwordValue=""
            onPasswordChange={(val) => console.log('Password:', val)}
            onSubmit={(email, password) => console.log('Submit:', { email, password })}
            onRegisterClick={() => console.log('Register clicked')}
            onForgotPasswordClick={() => console.log('Forgot password clicked')}
            registerText="Sign Up"
            forgotPasswordText="Reset Password"
            linkSeparator=" / "
          />
        </div>
      </div>
    </div>
  );
}
