import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CircleHelp } from 'lucide-react';

export interface GuideSection {
  title: string;
  items: string[];
}

/** 通用「操作指南」按钮 + 弹窗：设计器/管理页头部使用 */
export function GuideButton({ label, guide }: { label: string; guide: { intro: string; sections: GuideSection[] } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CircleHelp className="mr-1.5 h-4 w-4" />
        操作指南
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label} · 操作指南</DialogTitle>
            <DialogDescription>{guide.intro}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {guide.sections.map((s) => (
              <div key={s.title} className="rounded-md border border-border">
                <p className="border-b border-border bg-muted/40 px-3.5 py-2 text-sm font-medium">{s.title}</p>
                <ul className="space-y-1.5 px-3.5 py-3">
                  {s.items.map((it, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0">{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default GuideButton;
