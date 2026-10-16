import { useParams } from "react-router";

import Placeholder from "../components/Placeholder.jsx";

export default function TransactionDetail() {
  const { id } = useParams();
  return (
    <Placeholder title="Transaction">
      The score bar and explanation for transaction {id} will appear here.
    </Placeholder>
  );
}
