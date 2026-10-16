// The progress rule lives with the repository code; re-implemented here would drift, so import it lazily.
export { currentStep as currentStepFor } from "@/lib/repos/labs";
