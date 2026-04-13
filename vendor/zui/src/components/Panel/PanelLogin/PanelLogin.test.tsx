import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PanelLogin } from './PanelLogin';

describe('PanelLogin', () => {
  const defaultProps = {
    appName: 'Test App',
    description: 'Test description',
    emailValue: '',
    onEmailChange: vi.fn(),
    passwordValue: '',
    onPasswordChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  it('renders app name and description', () => {
    render(<PanelLogin {...defaultProps} />);
    expect(screen.getByText('Test App')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('renders email and password inputs', () => {
    render(<PanelLogin {...defaultProps} />);
    expect(screen.getByPlaceholderText('E-mail address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('renders login button', () => {
    render(<PanelLogin {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument();
  });

  it('calls onEmailChange when email input changes', () => {
    render(<PanelLogin {...defaultProps} />);
    const emailInput = screen.getByPlaceholderText('E-mail address');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    expect(defaultProps.onEmailChange).toHaveBeenCalledWith('test@example.com');
  });

  it('calls onPasswordChange when password input changes', () => {
    render(<PanelLogin {...defaultProps} />);
    const passwordInput = screen.getByPlaceholderText('Password');
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    expect(defaultProps.onPasswordChange).toHaveBeenCalledWith('password123');
  });

  it('calls onSubmit when form is submitted', () => {
    const props = {
      ...defaultProps,
      emailValue: 'test@example.com',
      passwordValue: 'password123',
    };
    render(<PanelLogin {...props} />);
    const form = screen.getByRole('button', { name: 'Log In' }).closest('form');
    fireEvent.submit(form!);
    expect(props.onSubmit).toHaveBeenCalledWith('test@example.com', 'password123');
  });

  it('disables inputs and button when isLoading is true', () => {
    render(<PanelLogin {...defaultProps} isLoading />);
    expect(screen.getByPlaceholderText('E-mail address')).toBeDisabled();
    expect(screen.getByPlaceholderText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
  });

  it('shows loading text when isLoading is true', () => {
    render(<PanelLogin {...defaultProps} isLoading />);
    expect(screen.getByRole('button', { name: 'Logging in...' })).toBeInTheDocument();
  });

  it('uses controlled input values', () => {
    render(
      <PanelLogin
        {...defaultProps}
        emailValue="existing@example.com"
        passwordValue="existingpass"
      />
    );
    expect(screen.getByPlaceholderText('E-mail address')).toHaveValue('existing@example.com');
    expect(screen.getByPlaceholderText('Password')).toHaveValue('existingpass');
  });
});
