import { FC, memo } from 'react';
import {
  AccordionBody,
  AccordionHeader,
  AccordionItem,
  Button,
  ButtonGroup,
  Col,
  Row,
  Table,
} from 'reactstrap';
import { Patch } from '../types';
import { CheckmarkIcon, CrossIcon } from '../utils/Images';
import PhrasePlayer from './PhrasePlayer';

interface Props {
  patch: Patch;
  onEdit: (directory: string) => void;
  onDelete: (directory: string) => void;
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

export const PatchListItem: FC<Props> = memo(({ patch, onEdit, onDelete }) => {
  const { data, dir, phrases } = patch;
  const patchData = data.JamManPatch;
  const patchName = patchData.PatchName?.[0] || '';

  return (
    <AccordionItem key={dir}>
      <AccordionHeader targetId={dir}>
        <strong>{dir}</strong>
        {!!patchName && <small className="ms-2">{patchName}</small>}
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
            {phrases.map(({ dir, data: { JamManPhrase: phrase }, wavPath }) => (
              <tr key={dir}>
                <td>{dir}</td>
                <td className="text-truncate">{phrase.ID?.[0] || 'N/A'}</td>
                <td>{phrase.BeatsPerMinute?.[0] || 'N/A'}</td>
                <td>{phrase.IsLoop[0] === '1' ? <CheckmarkIcon /> : <CrossIcon />}</td>
                <td>{phrase.IsReversed[0] === '1' ? <CheckmarkIcon /> : <CrossIcon />}</td>
                <td>{phrase.BeatsPerMeasure?.[0] || 'N/A'}</td>
                <td>
                  <PhrasePlayer wavPath={wavPath} />
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
});

PatchListItem.displayName = 'PatchListItem';

export default PatchListItem;
