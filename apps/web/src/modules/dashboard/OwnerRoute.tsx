import { PERMISSIONS } from '@pharmacy/shared';

import { usePermissions } from '../../hooks/useSession';
import { OwnerAssistant } from './OwnerAssistant';
import { OwnerDashboard } from './OwnerDashboard';

export default function OwnerRoute(): React.JSX.Element {
  const can = usePermissions();
  return (
    <>
      <OwnerDashboard />
      {can(PERMISSIONS.AI_OWNER_USE) ? (
        <div className="page" style={{ paddingBlockStart: 0 }}>
          <OwnerAssistant />
        </div>
      ) : null}
    </>
  );
}
