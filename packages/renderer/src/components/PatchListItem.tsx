import { FC, memo } from 'react';
import {
  AccordionBody,
  AccordionHeader,
  AccordionItem,
  Button,
  ButtonGroup,
  Col,
  Input,
  Row,
  Table,
} from 'reactstrap';
import { Patch } from '../types';
import { CheckmarkIcon, CrossIcon } from '../utils/Images';
import PhrasePlayer from './PhrasePlayer';

interface Props {
  patch: Patch;
  isSelected?: boolean;
  onEdit: (directory: string) => void;
  onDelete: (directory: string) => void;
  onToggleSelection?: (directory: string) => void;
}

const headersWidths = {
  xs: 5,
  sm: 3,
  md: 3,
  lg: 2,
  xl: 2,
  xxl: 1,
};

const valuesWidths = {
  xs: 7,
  sm: 9,
  md: 3,
  lg: 4,
  xl: 4,
  xxl: 3,
};

export const PatchListItem: FC<Props> = memo(
  ({ patch, isSelected = false, onEdit, onDelete, onToggleSelection }) => {
    const { data, dir, phrases } = patch;
    const patchData = data.JamManPatch;
    const patchName = patchData.PatchName?.[0] || '';

    const handleCheckboxClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onToggleSelection) {
        onToggleSelection(dir);
      }
    };

    return (
      <AccordionItem
        key={dir}
        style={{
          backgroundColor: isSelected ? 'rgba(13, 110, 253, 0.1)' : undefined,
          borderLeft: isSelected ? '3px solid #0d6efd' : undefined,
        }}
      >
        <AccordionHeader targetId={dir}>
          <div className="d-flex align-items-center gap-2 w-100">
            {onToggleSelection && (
              <Input
                type="checkbox"
                checked={isSelected}
                onClick={handleCheckboxClick}
                onChange={() => {}}
                style={{ cursor: 'pointer', marginTop: 0 }}
              />
            )}
            <div className="flex-grow-1">
              <strong>{dir}</strong>
              {!!patchName && <small className="ms-2">{patchName}</small>}
            </div>
            {isSelected && (
              <span className="badge bg-primary" style={{ fontSize: '0.7rem' }}>
                Selected
              </span>
            )}
          </div>
        </AccordionHeader>
        <AccordionBody accordionId={dir}>
          <Row className="mb-3 gy-2">
            <Col {...headersWidths}>
              <strong>Patch name:</strong>
            </Col>
            <Col {...valuesWidths}>{patchName}</Col>
            <Col {...headersWidths}>
              <strong>Device:</strong>
            </Col>
            <Col {...valuesWidths}>{patchData.$.device}</Col>
            <Col {...headersWidths}>
              <strong>ID:</strong>
            </Col>
            <Col {...valuesWidths} className="text-truncate">
              {patchData.ID[0] || 'N/A'}
            </Col>
            <Col {...headersWidths}>
              <strong>Origin ID:</strong>
            </Col>
            <Col {...valuesWidths} className="text-truncate">
              {patchData.OriginID?.[0] || 'N/A'}
            </Col>
            <Col {...headersWidths}>
              <strong>Rhythm Type:</strong>
            </Col>
            <Col {...valuesWidths}>{patchData.RhythmType?.[0] || 'N/A'}</Col>
            <Col {...headersWidths}>
              <strong>Stop Mode:</strong>
            </Col>
            <Col {...valuesWidths}>{patchData.StopMode?.[0] || 'N/A'}</Col>
            <Col {...headersWidths}>
              <strong>Settings Ver.:</strong>
            </Col>
            <Col {...valuesWidths}>{patchData.SettingsVersion?.[0] || 'N/A'}</Col>
          </Row>

          <Table responsive className="border">
            <thead>
              <tr>
                <th colSpan={7} className="text-center">
                  Phrases
                </th>
              </tr>
              <tr>
                <th>Directory</th>
                <th>ID</th>
                <th>BPM</th>
                <th>Loop</th>
                <th>Reversed</th>
                <th>Time Signature</th>
                <th>Audio</th>
              </tr>
            </thead>
            <tbody>
              {phrases.map(({ dir: phraseDir, data: { JamManPhrase: phrase }, wavPath }) => (
                <tr key={phraseDir}>
                  <td>{phraseDir}</td>
                  <td className="text-truncate">{phrase.ID?.[0] || 'N/A'}</td>
                  <td>{phrase.BeatsPerMinute?.[0] || 'N/A'}</td>
                  <td>{phrase.IsLoop[0] === '1' ? <CheckmarkIcon /> : <CrossIcon />}</td>
                  <td>{phrase.IsReversed[0] === '1' ? <CheckmarkIcon /> : <CrossIcon />}</td>
                  <td>{phrase.BeatsPerMeasure?.[0] || 'N/A'}</td>
                  <td>
                    <PhrasePlayer
                      wavPath={wavPath}
                      patchDir={dir}
                      patchName={patchName}
                      phraseName={phraseDir}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Row className="justify-content-end">
            <Col xs="auto">
              <ButtonGroup>
                <Button color="primary" onClick={() => onEdit(dir)}>
                  Edit
                </Button>
                <Button color="danger" onClick={() => onDelete(dir)}>
                  Delete
                </Button>
              </ButtonGroup>
            </Col>
          </Row>
        </AccordionBody>
      </AccordionItem>
    );
  },
);

PatchListItem.displayName = 'PatchListItem';

export default PatchListItem;
