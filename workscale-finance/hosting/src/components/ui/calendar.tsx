import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months:               'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month:                'space-y-4',
        caption:              'flex justify-center pt-1 relative items-center',
        caption_label:        'text-sm font-medium',
        nav:                  'space-x-1 flex items-center',
        nav_button:           cn(
          'inline-flex items-center justify-center rounded-md border border-input bg-white h-7 w-7 text-sm shadow-sm hover:bg-accent',
        ),
        nav_button_previous:  'absolute left-1',
        nav_button_next:      'absolute right-1',
        table:                'w-full border-collapse space-y-1',
        head_row:             'flex',
        head_cell:            'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        row:                  'flex w-full mt-2',
        cell:                 cn(
          'relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md',
        ),
        day:                  cn(
          'inline-flex items-center justify-center h-8 w-8 rounded-md p-0 font-normal aria-selected:opacity-100 hover:bg-accent hover:text-accent-foreground focus:outline-none',
        ),
        day_range_start:      'day-range-start',
        day_range_end:        'day-range-end',
        day_selected:         'bg-[#2CA01C] text-white hover:bg-[#238716] hover:text-white focus:bg-[#2CA01C] focus:text-white',
        day_today:            'bg-accent text-accent-foreground',
        day_outside:          'day-outside text-muted-foreground opacity-50',
        day_disabled:         'text-muted-foreground opacity-50',
        day_range_middle:     'aria-selected:bg-accent aria-selected:text-accent-foreground',
        day_hidden:           'invisible',
        ...classNames,
      }}
      components={{
        IconLeft:  () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}

Calendar.displayName = 'Calendar';

export { Calendar };
