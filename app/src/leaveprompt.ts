/** The leave-site prompt can be turned off with `?noleaveprompt=1`, in development builds only (agents use it to close their own tabs). */
export const leavePromptDisabled = (dev: boolean, search: string): boolean => dev && new URLSearchParams(search).has("noleaveprompt");
