// Widget J — Add Widgets card
import { Plus } from 'lucide-react';
import { WidgetShell } from './WidgetShell.jsx';

export function AddWidgetCard() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-[#E5E7EB] p-5 text-center">
      <h3 className="text-[18px] font-semibold text-[#1F2937] mb-3">Add widgets</h3>
      <div className="h-12 w-12 rounded-full border-2 border-[#E5E7EB] flex items-center justify-center mb-4 hover:border-[#F97316] hover:text-[#F97316] cursor-pointer transition-colors text-[#9CA3AF]">
        <Plus size={22} />
      </div>
      <hr className="w-full border-[#F3F4F6] mb-4" />
      <p className="text-[12px] font-semibold text-[#6B7280] mb-2">✨ Smart suggestions</p>
      <div className="flex items-center gap-2 border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-[12px] text-[#1F2937]">
        <span>Cash flow forecast</span>
        <button className="ml-2 text-[#F97316] font-semibold hover:underline">Add</button>
      </div>
      <button className="mt-3 text-[11px] text-[#9CA3AF] hover:text-[#6B7280] hover:underline">
        Why am I seeing these suggestions?
      </button>
    </div>
  );
}
