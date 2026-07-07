<script lang="ts">
  let { 
    options, 
    value = $bindable(), 
    formatLabel, 
    hasColor = false,
    small = false,
    onChange
  } = $props<{
    options: any[];
    value: string;
    formatLabel: (opt: any) => string;
    hasColor?: boolean;
    small?: boolean;
    onChange?: (id: string) => void;
  }>();

  let isOpen = $state(false);
  let selectedOption = $derived(options.find(o => o.id === value));

  function selectOption(id: string) {
    value = id;
    if (onChange) onChange(id);
    isOpen = false;
  }
</script>

<div class="relative w-full">
  <button 
    type="button" 
    class="w-full bg-zinc-950 border {isOpen ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-zinc-800 hover:border-zinc-700'} rounded-lg px-4 {small ? 'h-[38px] text-xs' : 'h-[50px] text-sm'} text-left text-zinc-200 transition-all flex items-center justify-between shadow-inner"
    onclick={() => isOpen = !isOpen}
    onblur={() => setTimeout(() => isOpen = false, 150)}
  >
    <span class="flex items-center gap-3 min-w-0">
      {#if hasColor && selectedOption}
        <span class="w-4 h-4 rounded-full border border-zinc-700 block shadow-sm shrink-0" style="background-color: {selectedOption.hex}"></span>
      {/if}
      <span class="truncate">{selectedOption ? formatLabel(selectedOption) : 'Select...'}</span>
    </span>
    <svg class="w-5 h-5 text-zinc-500 transition-transform duration-200 {isOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
    </svg>
  </button>

  {#if isOpen}
    <ul class="absolute z-50 w-full mt-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden max-h-64 overflow-y-auto flex flex-col py-1">
      {#each options as opt}
        <li>
          <button 
            type="button"
            class="w-full text-left px-4 py-3 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors flex items-center gap-3 {value === opt.id ? 'bg-indigo-500/20 text-indigo-300 font-medium' : ''}"
            onclick={() => selectOption(opt.id)}
          >
            {#if hasColor}
              <span class="w-4 h-4 rounded-full border border-zinc-600 block shadow-sm shrink-0" style="background-color: {opt.hex}"></span>
            {/if}
            <span class="truncate">{formatLabel(opt)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
