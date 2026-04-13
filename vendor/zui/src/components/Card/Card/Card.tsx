import React from 'react';
import clsx from 'clsx';
import styles from './Card.module.css';

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div className={clsx(styles.card, className)} {...props}>
      {children}
    </div>
  );
};
