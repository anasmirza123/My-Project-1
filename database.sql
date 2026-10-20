CREATE TABLE Customers (
    id INT IDENTITY(1,1) PRIMARY KEY,
    phone NVARCHAR(50) UNIQUE NOT NULL,
    type NVARCHAR(50) NOT NULL,
    name NVARCHAR(100),
    company NVARCHAR(100),
    notes NVARCHAR(MAX),
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE Products (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    category NVARCHAR(50) NOT NULL,
    price DECIMAL(18,2) DEFAULT 0,
    stock INT DEFAULT 0,
    min_stock INT DEFAULT 5,
    created_at DATETIME2 DEFAULT GETDATE()
);

CREATE TABLE Leads (
    id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT,
    status NVARCHAR(50) NOT NULL,
    notes NVARCHAR(MAX),
    lost_reason NVARCHAR(100),
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (customer_id) REFERENCES Customers(id)
);

CREATE TABLE Orders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    customer_id INT,
    total_amount DECIMAL(18,2) DEFAULT 0,
    paid_amount DECIMAL(18,2) DEFAULT 0,
    status NVARCHAR(50) DEFAULT 'Draft',
    tracking_id NVARCHAR(100),
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (customer_id) REFERENCES Customers(id)
);

CREATE TABLE InventoryMovements (
    id INT IDENTITY(1,1) PRIMARY KEY,
    product_id INT,
    type NVARCHAR(20) NOT NULL,
    qty INT NOT NULL,
    reference NVARCHAR(100),
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (product_id) REFERENCES Products(id)
);
