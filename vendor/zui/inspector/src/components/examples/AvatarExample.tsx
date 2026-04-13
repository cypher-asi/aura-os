import { Avatar, Heading } from '@cypher-asi/zui';
import { User, Bot, UserCircle } from 'lucide-react';
import styles from './Example.module.css';

export function avatarExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>With Images</Heading>
        <div className={styles.row}>
          <Avatar name="John Doe" src="https://i.pravatar.cc/150?img=1" size="xs" />
          <Avatar name="Jane Smith" src="https://i.pravatar.cc/150?img=2" size="sm" />
          <Avatar name="Bob Johnson" src="https://i.pravatar.cc/150?img=3" size="md" />
          <Avatar name="Alice Williams" src="https://i.pravatar.cc/150?img=4" size="lg" />
          <Avatar name="Charlie Brown" src="https://i.pravatar.cc/150?img=5" size="xl" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>With Initials (No Image)</Heading>
        <div className={styles.row}>
          <Avatar name="John Doe" size="xs" />
          <Avatar name="Jane Smith" size="sm" />
          <Avatar name="Bob Johnson" size="md" />
          <Avatar name="Alice Williams" size="lg" />
          <Avatar name="Charlie Brown" size="xl" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>With Icon (Default User)</Heading>
        <div className={styles.row}>
          <Avatar name="User" icon size="xs" />
          <Avatar name="User" icon size="sm" />
          <Avatar name="User" icon size="md" />
          <Avatar name="User" icon size="lg" />
          <Avatar name="User" icon size="xl" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>With Custom Icons</Heading>
        <div className={styles.row}>
          <Avatar name="User" icon={User} size="md" />
          <Avatar name="Bot" icon={Bot} size="md" />
          <Avatar name="Profile" icon={UserCircle} size="md" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Square Variant (Organizations/Teams)</Heading>
        <div className={styles.row}>
          <Avatar name="Acme Corp" square size="xs" />
          <Avatar name="Tech Inc" square size="sm" />
          <Avatar name="Design Co" square size="md" />
          <Avatar name="Build LLC" square size="lg" />
          <Avatar name="Cloud Systems" square size="xl" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Square with Images</Heading>
        <div className={styles.row}>
          <Avatar name="Acme Corp" src="https://i.pravatar.cc/150?img=6" square size="sm" />
          <Avatar name="Tech Inc" src="https://i.pravatar.cc/150?img=7" square size="md" />
          <Avatar name="Design Co" src="https://i.pravatar.cc/150?img=8" square size="lg" />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Single Name</Heading>
        <div className={styles.row}>
          <Avatar name="John" size="md" />
          <Avatar name="Jane" size="md" />
          <Avatar name="Bob" size="md" />
        </div>
      </div>
    </div>
  );
}
