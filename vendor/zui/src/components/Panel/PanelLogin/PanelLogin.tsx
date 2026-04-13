import { type FormEvent, type CSSProperties, type ReactNode, useState, useEffect } from 'react';
import { Panel } from '../Panel';
import { Heading } from '../../Heading';
import { Text } from '../../Text';
import { Input } from '../../Input';
import { Button } from '../../Button';
import clsx from 'clsx';
import styles from './PanelLogin.module.css';

export interface LoginProvider {
  /** Unique identifier for the provider */
  id: string;
  /** Icon element for the provider */
  icon: ReactNode;
  /** Accessible label for the provider (for screen readers) */
  label: string;
  /** Click handler for provider login */
  onClick: () => void;
}

export interface PanelLoginProps {
  /** Application name displayed at the top */
  appName: string;
  /** Description text displayed below app name */
  description: string;
  /** Email input value */
  emailValue: string;
  /** Email input change handler */
  onEmailChange: (value: string) => void;
  /** Password input value */
  passwordValue: string;
  /** Password input change handler */
  onPasswordChange: (value: string) => void;
  /** Form submission handler */
  onSubmit: (email: string, password: string) => void;
  /** Whether the form is in a loading/submitting state */
  isLoading?: boolean;
  /** Optional image URL to display at the top with fade effect */
  image?: string;
  /** Height of the image area (default: '200px') */
  imageHeight?: string;
  /** Optional login providers (e.g., Google, X, etc.) */
  loginProviders?: LoginProvider[];
  /** Optional click handler for register link */
  onRegisterClick?: () => void;
  /** Optional click handler for forgot password link */
  onForgotPasswordClick?: () => void;
  /** Custom text for register link (default: 'Register Identity') */
  registerText?: string;
  /** Custom text for forgot password link (default: 'Forgot Password') */
  forgotPasswordText?: string;
  /** Custom separator text between links (default: ' or ') */
  linkSeparator?: string;
  /** Optional custom content for the bottom section (overrides default register/forgot password links) */
  bottomContent?: ReactNode;
}

export function PanelLogin({
  appName,
  description,
  emailValue,
  onEmailChange,
  passwordValue,
  onPasswordChange,
  onSubmit,
  isLoading = false,
  image,
  imageHeight,
  loginProviders,
  onRegisterClick,
  onForgotPasswordClick,
  registerText,
  forgotPasswordText,
  linkSeparator = ' or ',
  bottomContent,
}: PanelLoginProps) {
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [showRealTimeValidation, setShowRealTimeValidation] = useState(false);

  // Clear error states when values change
  useEffect(() => {
    if (emailValue) setEmailError(false);
  }, [emailValue]);

  useEffect(() => {
    if (passwordValue) setPasswordError(false);
  }, [passwordValue]);

  const isValidEmail = (email: string) => {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Real-time email validation
  const getEmailValidationMessage = () => {
    if (!emailValue.trim()) {
      return emailError ? 'Email is required' : undefined;
    }
    // Show validation for invalid format only if user has started typing
    if (showRealTimeValidation && emailValue.trim() && !isValidEmail(emailValue)) {
      return 'Please enter a valid email address';
    }
    if (emailError) {
      return 'Please enter a valid email address';
    }
    return undefined;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    // Custom validation
    const hasEmailError = !emailValue.trim() || !isValidEmail(emailValue);
    const hasPasswordError = !passwordValue.trim();
    
    if (hasEmailError || hasPasswordError) {
      setEmailError(hasEmailError);
      setPasswordError(hasPasswordError);
      return;
    }
    
    onSubmit(emailValue, passwordValue);
  };

  const formWrapperStyle: CSSProperties = image ? {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-8) var(--space-6)',
  } : {};

  const formContent = (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.header}>
        <Heading level={2} className={styles.appName}>
          {appName}
        </Heading>
        <Text variant="secondary" size="sm" align="center" className={styles.description}>
          {description}
        </Text>
      </div>

      <div className={styles.inputs}>
          <Input
            type="text"
            placeholder="E-mail"
            value={emailValue}
            onChange={(e) => {
              onEmailChange(e.target.value);
              // Enable real-time validation after user starts typing
              if (e.target.value.length > 0) {
                setShowRealTimeValidation(true);
              }
            }}
            onBlur={() => setShowRealTimeValidation(true)}
            disabled={isLoading}
            className={clsx(emailError && styles.inputError)}
            validationMessage={getEmailValidationMessage()}
            autoFocus
          />
        <Input
          type="password"
          placeholder="Password"
          value={passwordValue}
          onChange={(e) => onPasswordChange(e.target.value)}
          disabled={isLoading}
          className={clsx(passwordError && styles.inputError)}
          validationMessage={passwordError ? 'Password is required' : undefined}
        />
        
        {loginProviders && loginProviders.length > 0 && (
          <div className={styles.providers}>
            {loginProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="secondary"
                className={styles.providerButton}
                onClick={provider.onClick}
                icon={provider.icon}
                iconOnly
                disabled={isLoading}
                aria-label={provider.label}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <Button
          type="submit"
          variant="ghost"
          className={styles.loginButton}
          disabled={isLoading}
        >
          {isLoading ? 'Logging in...' : 'Log In'}
        </Button>
      </div>

      {bottomContent ? (
        <div className={styles.links}>
          {bottomContent}
        </div>
      ) : (registerText || forgotPasswordText) ? (
        <div className={styles.links}>
          <Text variant="secondary" size="sm" align="center">
            {onRegisterClick ? (
              <button
                type="button"
                onClick={onRegisterClick}
                className={styles.link}
                disabled={isLoading}
              >
                {registerText}
              </button>
            ) : (
              <span>{registerText}</span>
            )}
            {linkSeparator}
            {onForgotPasswordClick ? (
              <button
                type="button"
                onClick={onForgotPasswordClick}
                className={styles.link}
                disabled={isLoading}
              >
                {forgotPasswordText}
              </button>
            ) : (
              <span>{forgotPasswordText}</span>
            )}
          </Text>
        </div>
      ) : null}
    </form>
  );

  return (
    <Panel 
      variant="glass" 
      border="future" 
      className={clsx(styles.container, !image && styles.containerWithPadding)}
      image={image}
      imageHeight={imageHeight}
    >
      {image ? (
        <div style={formWrapperStyle}>
          {formContent}
        </div>
      ) : (
        formContent
      )}
    </Panel>
  );
}
