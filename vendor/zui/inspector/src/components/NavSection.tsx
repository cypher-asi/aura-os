import { GroupCollapsible, Item } from '@cypher-asi/zui';
import { ComponentInfo } from '../data/componentRegistry';

interface NavSectionProps {
  title: string;
  items: ComponentInfo[];
  activeId: string;
  onItemClick: (id: string) => void;
}

export function NavSection({ title, items, activeId, onItemClick }: NavSectionProps) {
  return (
    <GroupCollapsible title={title} defaultOpen>
      {items.map((item) => (
        <Item
          key={item.id}
          active={activeId === item.id}
          onClick={() => onItemClick(item.id)}
        >
          <Item.Label>{item.name}</Item.Label>
        </Item>
      ))}
    </GroupCollapsible>
  );
}
