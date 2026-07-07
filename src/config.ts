export const config = {
  brand: {
    name: "PrintMatrix",
    contactEmail: "hello@printmatrix.com"
  },
  settings: {
    maxFileSizeBytes: 25 * 1024 * 1024, // 25 MB
    failureBufferPercent: 10,
    setupFee: 50.00
  },
  printerBed: {
    x: 220, // mm
    y: 220, // mm (height)
    z: 220  // mm
  },
  colors: [
    { id: "white", name: "White", hex: "#f8f9fa" },
    { id: "black", name: "Black", hex: "#111111" },
    { id: "silver", name: "Silver", hex: "#cbd5e1" },
    { id: "grey", name: "Dark Grey", hex: "#64748b" },
    { id: "red", name: "Red", hex: "#ef4444" },
    { id: "orange", name: "Orange", hex: "#f97316" },
    { id: "yellow", name: "Yellow", hex: "#eab308" },
    { id: "green", name: "Green", hex: "#22c55e" },
    { id: "lime", name: "Lime Green", hex: "#84cc16" },
    { id: "forest", name: "Forest Green", hex: "#15803d" },
    { id: "cyan", name: "Cyan", hex: "#06b6d4" },
    { id: "blue", name: "Blue", hex: "#3b82f6" },
    { id: "purple", name: "Purple", hex: "#a855f7" },
    { id: "pink", name: "Pink", hex: "#ec4899" },
    { id: "brown", name: "Brown", hex: "#78350f" },
    { id: "bone", name: "Bone / Beige", hex: "#fef3c7" }
  ],
  materials: [
    {
      id: "pla",
      name: "PLA (Polylactic Acid)",
      density: 1.24,
      costPerGram: 4.00
    },
    {
      id: "petg",
      name: "PETG",
      density: 1.27,
      costPerGram: 4.80
    },
    {
      id: "abs",
      name: "ABS",
      density: 1.04,
      costPerGram: 4.80
    },
    {
      id: "tpu",
      name: "TPU (Flexible)",
      density: 1.21,
      costPerGram: 7.20
    },
    {
      id: "asa",
      name: "ASA",
      density: 1.07,
      costPerGram: 6.40
    },
    {
      id: "nylon",
      name: "Nylon",
      density: 1.14,
      costPerGram: 12.80
    }
  ],
  qualities: [
    {
      id: "draft-0.8",
      name: "Draft (0.8mm Nozzle)",
      layerHeight: 0.40,
      shellThickness: 1.6
    },
    {
      id: "fast-0.6",
      name: "Fast (0.6mm Nozzle)",
      layerHeight: 0.30,
      shellThickness: 1.2
    },
    {
      id: "standard-0.4",
      name: "Standard (0.4mm Nozzle)",
      layerHeight: 0.20,
      shellThickness: 0.8
    },
    {
      id: "fine-0.2",
      name: "Ultra Fine (0.2mm Nozzle)",
      layerHeight: 0.12,
      shellThickness: 0.6
    }
  ]
};
