import { LoaderCircle, Save, X } from "lucide-react";
import { DocumentButton, documentStyles } from "./DocumentSurface";

export default function DocumentEditActions({ onCancel, onSave, isSaving, saveDisabled = false, saveAriaLabel }: {
  onCancel: () => void;
  onSave: () => void;
  isSaving: boolean;
  saveDisabled?: boolean;
  saveAriaLabel?: string;
}) {
  return (
    <>
      <DocumentButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={isSaving}
        className={documentStyles.secondary}
      >
        <X size={16} />
        Cancel
      </DocumentButton>
      <DocumentButton
        type="button"
        size="sm"
        onClick={onSave}
        aria-label={saveAriaLabel}
        disabled={isSaving || saveDisabled}
        className={documentStyles.primary}
      >
        {isSaving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
        {isSaving ? "Saving..." : "Save"}
      </DocumentButton>
    </>
  );
}
