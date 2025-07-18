interface DropdownButtonProps {
  options: string[];
  onSelect: (option: string) => void;
}

const DropdownButton = ({ options, onSelect }: DropdownButtonProps) => {
  return (
    <div className="dropdown-menu">
      {options.map(option => (
        <div 
          key={option} 
          className="dropdown-item"
          onClick={() => onSelect(option)}
        >
          {option}
        </div>
      ))}
    </div>
  )
}

export default DropdownButton