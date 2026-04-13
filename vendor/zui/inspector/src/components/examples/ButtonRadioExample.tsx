import { ButtonRadio, Heading } from '@cypher-asi/zui';
import { useState } from 'react';
import styles from './Example.module.css';

export function buttonradioExample() {
  const [selectedOption, setSelectedOption] = useState('option1');
  const [selectedSize, setSelectedSize] = useState('medium');

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Basic Radio Group</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ButtonRadio
            name="basic-options"
            value="option1"
            label="Option 1"
            checked={selectedOption === 'option1'}
            onChange={() => setSelectedOption('option1')}
          />
          <ButtonRadio
            name="basic-options"
            value="option2"
            label="Option 2"
            checked={selectedOption === 'option2'}
            onChange={() => setSelectedOption('option2')}
          />
          <ButtonRadio
            name="basic-options"
            value="option3"
            label="Option 3"
            checked={selectedOption === 'option3'}
            onChange={() => setSelectedOption('option3')}
          />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Size Options</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ButtonRadio
            name="size-options"
            value="small"
            label="Small Size"
            checked={selectedSize === 'small'}
            onChange={() => setSelectedSize('small')}
          />
          <ButtonRadio
            name="size-options"
            value="medium"
            label="Medium Size"
            checked={selectedSize === 'medium'}
            onChange={() => setSelectedSize('medium')}
          />
          <ButtonRadio
            name="size-options"
            value="large"
            label="Large Size"
            checked={selectedSize === 'large'}
            onChange={() => setSelectedSize('large')}
          />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Disabled State</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ButtonRadio
            name="disabled-options"
            value="disabled1"
            label="Disabled Unchecked"
            disabled
            checked={false}
            onChange={() => {}}
          />
          <ButtonRadio
            name="disabled-options"
            value="disabled2"
            label="Disabled Checked"
            disabled
            checked={true}
            onChange={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
