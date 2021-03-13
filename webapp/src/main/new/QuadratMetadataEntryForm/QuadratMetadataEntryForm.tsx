import { Quadrat } from "../../../types";
import { PlantFormMetadata } from "./plantForm/plantFormMetadata";

interface QuadratMetadataEntryFormProps {
    quadrats: Quadrat[];
}

export const QuadratMetadataEntryForm = (props: QuadratMetadataEntryFormProps) => (
    <PlantFormMetadata />
);
QuadratMetadataEntryForm.defaultName = 'QuadratMetadataEntryForm';