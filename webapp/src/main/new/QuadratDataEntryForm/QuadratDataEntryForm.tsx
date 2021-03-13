import { useState } from 'react';

import { Quadrat, Stem } from '../../../types';

const StemInput = () => (
    <tr>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><input type="text"/></td>
        <td><button>Remove</button></td>
    </tr>
);

interface QuadratDataEntryFormProps {
    quadrat: Quadrat;
    setFormData: (stems: Stem[]) => void;
}

export const QuadratDataEntryForm = (props: QuadratDataEntryFormProps) => {
    const [stems, setStems] = useState<JSX.Element[]>([]);
    return (
        <>
            <table>
                <thead>
                    <tr>
                        <th>Subquadrat</th>
                        <th>Tag</th>
                        <th>StemTag</th>
                        <th>SpCode</th>
                        <th>DBH</th>
                        <th>Codes</th>
                        <th>Comments</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {stems}
                </tbody>
                <tfoot>
                    <tr>
                        <td>
                            <button onClick={() => {
                                setStems([...stems, StemInput()]);
                            }}>Add stem</button>
                        </td>
                    </tr>
                </tfoot>
            </table>
        </>
    );
};
QuadratDataEntryForm.defaultName = 'QuadratDataEntryForm';